import { PermissionFlagsBits } from "discord.js";
import { db, transaction } from "./database.js";
import { sendToLogsHub } from "./logs-hub.js";
import { systemLogEmbed } from "./logs.js";
import { incrementDailyMetric } from "./organization.js";
import { reconcileVoiceSessions } from "./voice-session-reconciliation.js";

const P = PermissionFlagsBits;

function recordAuditEvent({ guildId, eventKey = null, category, action, actorId = null, targetId = null, channelId = null, details = {}, occurredAt = Date.now(), source = "gateway" }) {
  const result = db.prepare(`INSERT OR IGNORE INTO audit_events
    (guild_id,event_key,category,action,actor_id,target_id,channel_id,details_json,occurred_at,source)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(guildId, eventKey, category, action, actorId, targetId, channelId, JSON.stringify(details), occurredAt, source);
  return Number(result.changes) > 0;
}

async function findVoiceAuditActor(guild, memberId, botId, now = Date.now(), destinationChannelId = null) {
  try {
    const { AuditLogEvent } = await import("discord.js");
    const expectedTypes = destinationChannelId ? [AuditLogEvent.MemberMove] : [AuditLogEvent.MemberDisconnect];
    for (const type of expectedTypes) {
      const logs = await guild.fetchAuditLogs({ type, limit: 8 });
      const matches = [...logs.entries.values()].filter((entry) => {
        const age = now - Number(entry.createdTimestamp ?? 0);
        if (entry.target?.id !== memberId || !entry.executor?.id || entry.executor.id === botId || age < 0 || age > 6_000) return false;
        if (type === AuditLogEvent.MemberMove && destinationChannelId && entry.extra?.channel?.id && entry.extra.channel.id !== destinationChannelId) return false;
        return true;
      }).sort((a, b) => Number(b.createdTimestamp ?? 0) - Number(a.createdTimestamp ?? 0));
      const match = matches[0];
      if (match?.executor?.id) return { actorId: match.executor.id, action: type === AuditLogEvent.MemberMove ? "déplacement manuel" : "déconnexion manuelle" };
    }
  } catch {
    // Audit Logs may be unavailable due to missing permission or an expired entry.
  }
  return { actorId: null, action: null };
}

function publishVoiceLog(client, guild, { title, description, color = 0xe21d2f }) {
  void sendToLogsHub(client, guild, systemLogEmbed({ category: "voice", title, description, color }), title, [], [], { category: "voice" }).catch(() => {});
}

/** Track only channel presence metadata. No voice/audio payload is accessed or stored. */
export async function trackVoiceStateUpdate(oldState, newState, client, now = Date.now()) {
  const guild = newState.guild ?? oldState.guild;
  const memberId = newState.id ?? oldState.id;
  if (!guild || !memberId || oldState.channelId === newState.channelId || newState.member?.user?.bot) return false;
  const fromId = oldState.channelId ?? null;
  const toId = newState.channelId ?? null;
  const existing = db.prepare(`SELECT id,channel_id,joined_at,start_precision FROM voice_sessions
    WHERE guild_id=? AND user_id=? AND left_at IS NULL`).get(guild.id, memberId);
  let durationMs = null;
  let incomplete = false;

  transaction(() => {
    if (existing) {
      durationMs = Math.max(0, now - Number(existing.joined_at));
      db.prepare(`UPDATE voice_sessions SET left_at=?,duration_ms=?,end_reason=?,end_precision='exact'
        WHERE id=? AND left_at IS NULL`).run(now, durationMs, toId ? "move" : "leave", existing.id);
    } else if (fromId) {
      incomplete = true;
    }
    if (toId) {
      db.prepare(`INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,start_precision)
        VALUES(?,?,?,?, 'exact')`).run(guild.id, memberId, toId, now);
    }
  });
  if (durationMs !== null && durationMs >= 60_000) {
    try { incrementDailyMetric(guild.id, "voice_minutes", Math.floor(durationMs / 60_000), now); } catch { /* Voice audit remains primary; analytics are best-effort. */ }
  }

  let actor = { actorId: null, action: null };
  if (fromId && toId) actor = await findVoiceAuditActor(guild, memberId, client?.user?.id, now, toId);
  else if (fromId && !toId) actor = await findVoiceAuditActor(guild, memberId, client?.user?.id, now, toId);

  const action = !fromId ? "connexion" : !toId ? "déconnexion" : "déplacement";
  const fromLabel = fromId ? `<#${fromId}>` : "Aucun";
  const toLabel = toId ? `<#${toId}>` : "Aucun";
  const durationLabel = durationMs == null ? "indisponible" : `${Math.floor(durationMs / 60_000)} min ${Math.floor((durationMs % 60_000) / 1000)} s`;
  const actorLabel = actor.actorId ? `<@${actor.actorId}> (${actor.action})` : "Non identifié via Audit Log";
  const description = `Membre : <@${memberId}>\nAction : **${action}**\nAvant : ${fromLabel}\nAprès : ${toLabel}\nInitiateur : ${actorLabel}\nDurée de la session précédente : ${durationLabel}${incomplete ? "\n⚠️ Début de session antérieur à l'historique disponible." : ""}\nDate : <t:${Math.floor(now / 1000)}:F>`;
  const eventKey = `voice:${guild.id}:${memberId}:${now}:${fromId ?? "none"}:${toId ?? "none"}`;
  recordAuditEvent({
    guildId: guild.id,
    eventKey,
    category: "voice",
    action,
    actorId: actor.actorId,
    targetId: memberId,
    channelId: toId ?? fromId,
    details: { fromId, toId, durationMs, incomplete, actorResolution: actor.actorId ? "audit_log" : "unknown" },
    occurredAt: now,
  });
  publishVoiceLog(client, guild, {
    title: action === "connexion" ? "🔊 Connexion vocale" : action === "déconnexion" ? "🔇 Déconnexion vocale" : "↔️ Déplacement vocal",
    description,
  });
  return true;
}

/** Reconcile both sides of the snapshot: close stale sessions and recover active ones. */
export function reconcileActiveVoiceSessions(client, now = Date.now(), isTrackedGuild = () => true) {
  let changed = 0;
  for (const guild of client.guilds.cache.values()) {
    if (!isTrackedGuild(guild.id)) continue;
    const activeMembers = new Map();
    for (const voiceState of guild.voiceStates.cache.values()) {
      if (!voiceState.channelId || voiceState.member?.user?.bot) continue;
      activeMembers.set(voiceState.id, voiceState.channelId);
    }
    const result = reconcileVoiceSessions({
      db,
      transaction,
      guildId: guild.id,
      activeMembers,
      now,
      recordEvent: recordAuditEvent,
    });
    changed += result.created + result.closed;
  }
  return changed;
}

export function getVoiceMembersAt(guildId, timestamp) {
  if (!/^\d{5,25}$/.test(String(guildId)) || !Number.isSafeInteger(timestamp) || timestamp < 0) return [];
  return db.prepare(`SELECT user_id,channel_id,joined_at,left_at,start_precision,end_precision
    FROM voice_sessions
    WHERE guild_id=? AND joined_at<=? AND (left_at IS NULL OR left_at>?)
    ORDER BY channel_id,user_id`).all(guildId, timestamp, timestamp).map((row) => ({
      userId: row.user_id,
      channelId: row.channel_id,
      joinedAt: Number(row.joined_at),
      leftAt: row.left_at == null ? null : Number(row.left_at),
      precision: row.start_precision === "exact" && row.end_precision === "exact" ? "exact" : "approximate",
      startPrecision: row.start_precision,
      endPrecision: row.end_precision,
    }));
}

export async function handleVoicePresenceMessage(message) {
  if (!message?.guild || !String(message.content ?? "").trim().toLowerCase().startsWith("=vocalpresence")) return false;
  if (!message.member?.permissions?.has?.(P.ManageGuild) && !message.member?.permissions?.has?.(P.Administrator)) {
    await message.reply({ content: "⛔ Cette recherche d'historique vocal est réservée au staff autorisé.", allowedMentions: { parse: [] } });
    return true;
  }
  const raw = String(message.content).trim().split(/\s+/)[1];
  let timestamp = raw && /^\d{10,13}$/.test(raw) ? Number(raw) : raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(timestamp) && timestamp < 10_000_000_000) timestamp *= 1000;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > Date.now()) {
    await message.reply({ content: "Utilisation : `=vocalpresence 2026-11-16T20:00` ou `=vocalpresence 1794859200` (timestamp Unix en secondes).", allowedMentions: { parse: [] } });
    return true;
  }
  const rows = getVoiceMembersAt(message.guild.id, timestamp);
  const lines = rows.slice(0, 40).map((row) => `• <@${row.userId}> — <#${row.channelId}> — ${row.precision === "approximate" ? "présence approximative (coupure/redémarrage possible)" : "présence enregistrée"}`);
  await message.reply({
    content: `🎙️ **Présences vocales à <t:${Math.floor(timestamp / 1000)}:F>**\n${lines.length ? lines.join("\n") : "Aucune présence enregistrée à cette date. Attention : les périodes où le bot était hors ligne peuvent être incomplètes."}\n\nHistorique limité aux événements observés par le bot. Aucune conversation audio n'est enregistrée.`,
    allowedMentions: { parse: [] },
  });
  return true;
}

export function auditEventCount(guildId, category = null) {
  const row = category
    ? db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE guild_id=? AND category=?").get(guildId, category)
    : db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE guild_id=?").get(guildId);
  return Number(row.count);
}
