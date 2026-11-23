import { db } from "./database.js";
import { parsePndOwnerIds } from "./pnd-owner-policy.js";

const SNOWFLAKE = /^\d{5,25}$/;

export function getStaffMemberHistory(guildId, memberId, limit = 30) {
  if (typeof guildId !== "string" || !SNOWFLAKE.test(guildId) || typeof memberId !== "string" || !SNOWFLAKE.test(memberId)) {
    throw new Error("Identifiants serveur ou membre invalides.");
  }
  const bounded = Math.max(1, Math.min(50, Number(limit) || 30));
  const cases = db.prepare(`SELECT id,user_id,moderator_id,action,reason,details_json,created_at
    FROM moderation_cases WHERE guild_id=? AND (user_id=? OR moderator_id=?) ORDER BY created_at DESC LIMIT ?`)
    .all(guildId, memberId, memberId, bounded).map((row) => ({
      type: "moderation", id: row.id, occurredAt: Number(row.created_at),
      action: row.action, targetId: row.user_id, actorId: row.moderator_id,
      reason: row.reason, details: parseDetails(row.details_json),
    }));
  const audit = db.prepare(`SELECT id,category,action,actor_id,target_id,channel_id,details_json,occurred_at,source
    FROM audit_events WHERE guild_id=? AND (target_id=? OR actor_id=?) ORDER BY occurred_at DESC LIMIT ?`)
    .all(guildId, memberId, memberId, bounded).map((row) => ({
      type: row.category, id: row.id, occurredAt: Number(row.occurred_at), action: row.action,
      actorId: row.actor_id, targetId: row.target_id, channelId: row.channel_id,
      details: parseDetails(row.details_json), source: row.source,
    }));
  const applications = db.prepare(`SELECT a.application_id,a.applicant_id,a.status,a.reviewer_id,a.decision_note,a.updated_at,
      r.assignee_id FROM recruitment_applications a LEFT JOIN recruitment_assignments r
      ON r.guild_id=a.guild_id AND r.application_id=a.application_id
      WHERE a.guild_id=? AND (a.applicant_id=? OR a.reviewer_id=? OR r.assignee_id=?) ORDER BY a.updated_at DESC LIMIT ?`)
    .all(guildId, memberId, memberId, memberId, bounded).map((row) => ({
      type: "recruitment", id: row.application_id, occurredAt: Number(row.updated_at), action: `candidature ${row.status}`,
      targetId: row.applicant_id, actorId: row.reviewer_id, assigneeId: row.assignee_id, reason: row.decision_note ?? "",
    }));
  const incidents = db.prepare(`SELECT incident_id,title,severity,status,created_by,assigned_to,resolved_by,resolution,updated_at
    FROM sysplus_incidents WHERE guild_id=? AND (created_by=? OR assigned_to=? OR resolved_by=?)
    ORDER BY updated_at DESC LIMIT ?`).all(guildId, memberId, memberId, memberId, bounded).map((row) => ({
      type: "incident", id: row.incident_id, occurredAt: Number(row.updated_at), action: `incident ${row.status}`,
      actorId: row.resolved_by ?? row.created_by, targetId: row.assigned_to, title: row.title, severity: row.severity, reason: row.resolution ?? "",
    }));
  const interviews = db.prepare(`SELECT i.interview_id,i.application_id,a.applicant_id,i.interviewer_id,i.starts_at,i.updated_at,i.status,i.score,i.notes
    FROM recruitment_interviews i JOIN recruitment_applications a
      ON a.guild_id=i.guild_id AND a.application_id=i.application_id
    WHERE i.guild_id=? AND (a.applicant_id=? OR i.interviewer_id=? OR i.created_by=?)
    ORDER BY i.starts_at DESC LIMIT ?`).all(guildId, memberId, memberId, memberId, bounded).map((row) => ({
      type: "recruitment_interview", id: row.interview_id, occurredAt: Number(row.updated_at), startsAt: Number(row.starts_at), action: `entretien ${row.status}`,
      targetId: row.applicant_id, actorId: row.interviewer_id, score: row.score == null ? null : Number(row.score), reason: row.notes ?? "",
    }));
  const voice = db.prepare(`SELECT id,channel_id,joined_at,left_at,duration_ms,start_precision,end_precision,end_reason
    FROM voice_sessions WHERE guild_id=? AND user_id=? ORDER BY joined_at DESC LIMIT ?`)
    .all(guildId, memberId, bounded).map((row) => ({
      type: "voice_session", id: row.id, occurredAt: Number(row.joined_at), action: row.left_at == null ? "session active" : row.end_reason ?? "session terminée",
      targetId: memberId, channelId: row.channel_id, joinedAt: Number(row.joined_at),
      leftAt: row.left_at == null ? null : Number(row.left_at), durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      precision: row.start_precision === "exact" && row.end_precision === "exact" ? "exact" : "approximate",
    }));
  return [...cases, ...audit, ...applications, ...interviews, ...incidents, ...voice].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, bounded);
}

function parseDetails(value) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export async function handleStaffMemberHistoryMessage(message, { settings = {}, ownerIds = [] } = {}) {
  if (!message?.guild || !String(message.content ?? "").trim().toLowerCase().startsWith("=staffhistory")) return false;
  const guildSettings = settings?.[message.guild.id] ?? {};
  const sysPlusRoleId = guildSettings.sysPlus?.roleId;
  const adminPlusRoleId = guildSettings.adminPlus?.roleId;
  const hasStaffRole = (sysPlusRoleId && message.member?.roles?.cache?.has?.(sysPlusRoleId)) || (adminPlusRoleId && message.member?.roles?.cache?.has?.(adminPlusRoleId));
  const canReview = message.guild.ownerId === message.author.id || parsePndOwnerIds(ownerIds).includes(message.author.id) || hasStaffRole || message.member?.permissions?.has?.("ManageGuild") || message.member?.permissions?.has?.("Administrator");
  if (!canReview) {
    await message.reply({ content: "⛔ L'historique membre est réservé au propriétaire du serveur et au staff autorisé.", allowedMentions: { parse: [] } });
    return true;
  }
  const targetId = message.mentions?.users?.first?.()?.id ?? String(message.content).trim().split(/\s+/)[1]?.match(/^<@!?(\d{5,25})>$/)?.[1];
  if (!targetId) {
    await message.reply({ content: "Utilisation : `=staffhistory <@membre>`.", allowedMentions: { parse: [] } });
    return true;
  }
  const rows = getStaffMemberHistory(message.guild.id, targetId, 25);
  const lines = rows.map((entry) => {
    const actor = entry.actorId ? `<@${entry.actorId}>` : "Initiateur non identifié";
    if (entry.type === "moderation") return `• <t:${Math.floor(entry.occurredAt / 1000)}:f> — **${entry.action}** par ${actor} · ${entry.reason}`;
    if (entry.type === "recruitment") return `• <t:${Math.floor(entry.occurredAt / 1000)}:f> — 📄 **${entry.action}** · candidat <@${entry.targetId}>${entry.assigneeId ? ` · responsable <@${entry.assigneeId}>` : ""}${entry.reason ? ` · ${entry.reason}` : ""}`;
    if (entry.type === "incident") return `• <t:${Math.floor(entry.occurredAt / 1000)}:f> — 🚨 **${entry.action}** · ${entry.severity} · ${entry.title}${entry.targetId ? ` · responsable <@${entry.targetId}>` : ""}${entry.reason ? ` · ${entry.reason}` : ""}`;
    if (entry.type === "recruitment_interview") return `• <t:${Math.floor(entry.occurredAt / 1000)}:f> — 📅 **${entry.action}** · candidat <@${entry.targetId}> · évaluateur <@${entry.actorId}> · prévu <t:${Math.floor(entry.startsAt / 1000)}:F>${entry.score == null ? "" : ` · ${entry.score}/5`}${entry.reason ? ` · ${entry.reason}` : ""}`;
    if (entry.type === "voice_session") {
      const duration = entry.durationMs == null ? "en cours / durée inconnue" : `${Math.floor(entry.durationMs / 60_000)} min`;
      return `• <t:${Math.floor(entry.occurredAt / 1000)}:f> — 🎙️ ${entry.action} dans <#${entry.channelId}> · ${duration} · ${entry.precision === "approximate" ? "approximatif" : "exact"}`;
    }
    return `• <t:${Math.floor(entry.occurredAt / 1000)}:f> — **${entry.action}** (${entry.type}) par ${actor}${entry.channelId ? ` · <#${entry.channelId}>` : ""}`;
  });
  const content = `📚 **Historique staff — <@${targetId}>**\n${lines.length ? lines.join("\n") : "Aucun événement conservé."}\n\nHistorique limité aux événements observés et conservés par FWU.`;
  await message.reply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
  return true;
}
