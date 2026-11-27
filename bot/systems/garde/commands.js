// GARDE (SUCK ME) : /garde moi | releve | astreinte | demande-quota | appel | enquete | geler | bareme | bilan.
// Réservé aux SYS+. Lecture seule sauf astreinte (liste interne), appel (vote), geler (salon, rétabli tout seul).
import { PermissionFlagsBits } from "discord.js";
import { db } from "../../database.js";
import { sendCentralLog, systemLogEmbed } from "../../logs.js";
import { parsePndOwnerId } from "../../pnd-owner-policy.js";
import { recordSysPlusAudit } from "../sysplus/audit.js";
import { isSysPlus } from "../sysplus/permissions.js";
import { appealOutcome, countBy, formatDuration, nextSanction, nextWeeklyReport } from "./policy.js";

const P = PermissionFlagsBits;
db.exec(`CREATE TABLE IF NOT EXISTS garde_astreinte (guild_id TEXT NOT NULL, member_id TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (guild_id, member_id));
  CREATE TABLE IF NOT EXISTS garde_frozen_channels (guild_id TEXT NOT NULL, channel_id TEXT PRIMARY KEY, previous_slowmode INTEGER NOT NULL, had_overwrite INTEGER NOT NULL, previous_send TEXT, until INTEGER NOT NULL, by_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS garde_weekly_sent (guild_id TEXT NOT NULL, week INTEGER NOT NULL, PRIMARY KEY (guild_id, week));
  CREATE TABLE IF NOT EXISTS garde_end_reminders (case_id INTEGER PRIMARY KEY, sent_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS garde_planning (guild_id TEXT NOT NULL, member_id TEXT NOT NULL, dispos TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, member_id));`);

class GardeError extends Error {}
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const ts = (ms) => `<t:${Math.floor(Number(ms) / 1000)}:R>`;

async function requireSysPlus(interaction, settings) {
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor || !isSysPlus(actor, settings?.sysPlus?.roleId ?? null)) throw new GardeError("⛔ /garde est réservé aux membres SYS+.");
  return actor;
}

export function staffSummary(guildId, memberId, now = Date.now()) {
  const day = safe(() => db.prepare("SELECT action FROM moderation_cases WHERE guild_id=? AND moderator_id=? AND created_at>?").all(guildId, memberId, now - 86_400_000), []);
  const week = safe(() => db.prepare("SELECT action FROM moderation_cases WHERE guild_id=? AND moderator_id=? AND created_at>?").all(guildId, memberId, now - 7 * 86_400_000), []);
  const malus = safe(() => db.prepare("SELECT kind, member_id, expires_at FROM malus_active WHERE guild_id=? AND started_by=? AND expires_at>?").all(guildId, memberId, now), []);
  const voice = safe(() => db.prepare("SELECT COALESCE(SUM(duration_ms),0) AS ms FROM voice_sessions WHERE guild_id=? AND user_id=? AND joined_at>?").get(guildId, memberId, now - 7 * 86_400_000).ms, 0);
  return { day, week, malus, voiceMs: Number(voice) };
}

function moiText(guildId, memberId) {
  const s = staffSummary(guildId, memberId);
  const by = (rows) => countBy(rows, (r) => r.action).map(([a, n]) => `${a} ×${n}`).join(", ") || "aucune";
  return [
    "🪪 **Ton tableau SYS+**",
    `Sanctions 24 h : ${s.day.length} (${by(s.day)})`,
    `Sanctions 7 jours : ${s.week.length} (${by(s.week)})`,
    `Malus actifs posés par toi : ${s.malus.length ? s.malus.map((m) => `${m.kind} sur <@${m.member_id}> (fin ${ts(m.expires_at)})`).join(", ") : "aucun"}`,
    `Vocal sur 7 jours : ${formatDuration(s.voiceMs)}`,
    "Tes quotas restants : `/quota voir`.",
  ].join("\n");
}

function releveText(guild, hours, now = Date.now()) {
  const since = now - hours * 3_600_000;
  const cases = safe(() => db.prepare("SELECT user_id, moderator_id, action, reason, created_at FROM moderation_cases WHERE guild_id=? AND created_at>? ORDER BY created_at DESC").all(guild.id, since), []);
  const reports = safe(() => db.prepare("SELECT COUNT(*) AS n FROM guard_reports WHERE guild_id=? AND status='open'").get(guild.id).n, 0);
  const tickets = safe(() => db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id=? AND status='open'").get(guild.id).n, 0);
  const malus = safe(() => db.prepare("SELECT COUNT(*) AS n FROM malus_active WHERE guild_id=? AND expires_at>?").get(guild.id, now).n, 0);
  const raid = safe(() => db.prepare("SELECT active FROM guard_raid_state WHERE guild_id=?").get(guild.id)?.active, 0);
  const astreinte = safe(() => db.prepare("SELECT member_id FROM garde_astreinte WHERE guild_id=?").all(guild.id), []);
  return [
    `📋 **Relève : les ${hours} dernières heures**`,
    `Sanctions : ${cases.length}${cases.length ? ` (${countBy(cases, (c) => c.action).map(([a, n]) => `${a} ×${n}`).join(", ")})` : ""}`,
    ...cases.slice(0, 8).map((c) => `• ${c.action} <@${c.user_id}> par <@${c.moderator_id}> ${ts(c.created_at)} : ${String(c.reason).slice(0, 80)}`),
    `Signalements ouverts : ${reports} · Tickets ouverts : ${tickets} · Malus actifs : ${malus}`,
    `Mode raid : ${raid ? "🚨 actif" : "inactif"}`,
    `Astreinte : ${astreinte.length ? astreinte.map((a) => `<@${a.member_id}>`).join(", ") : "personne"}`,
  ].join("\n").slice(0, 1900);
}

function enqueteText(guild, member, now = Date.now()) {
  const id = member.id;
  const invite = safe(() => db.prepare("SELECT source, inviter_id, code, joined_at FROM member_invite_attribution WHERE guild_id=? AND user_id=?").get(guild.id, id), null);
  const cases = safe(() => db.prepare("SELECT action, reason, moderator_id, created_at FROM moderation_cases WHERE guild_id=? AND user_id=? ORDER BY created_at DESC").all(guild.id, id), []);
  const voice = safe(() => db.prepare("SELECT channel_id, joined_at, duration_ms FROM voice_sessions WHERE guild_id=? AND user_id=? ORDER BY joined_at DESC LIMIT 5").all(guild.id, id), []);
  const notes = safe(() => db.prepare("SELECT COUNT(*) AS n FROM sysplus_member_notes WHERE guild_id=? AND member_id=?").get(guild.id, id).n, 0);
  const malus = safe(() => db.prepare("SELECT kind FROM malus_active WHERE guild_id=? AND member_id=? AND expires_at>?").all(guild.id, id, now).map((r) => r.kind), []);
  const created = member.user?.createdTimestamp;
  const next = nextSanction(cases, { now });
  return [
    `🕵️ **Enquête : ${member.displayName ?? member.user?.username}** (<@${id}>)`,
    `Compte créé ${created ? ts(created) : "?"} · arrivé ${member.joinedTimestamp ? ts(member.joinedTimestamp) : "?"}`,
    `Invitation : ${invite ? `${invite.code ? `\`${invite.code}\`` : invite.source}${invite.inviter_id ? ` de <@${invite.inviter_id}>` : ""}` : "inconnue"}`,
    `Casier : ${cases.length} entrée(s)${cases.length ? ` — dernière : ${cases[0].action} ${ts(cases[0].created_at)}` : ""}`,
    `Barème : prochaine sanction proposée **${next.action}** (${next.count} sanction(s) sur 90 jours)`,
    `Vocal récent : ${voice.length ? voice.map((v) => `<#${v.channel_id}> ${ts(v.joined_at)}${v.duration_ms ? ` (${formatDuration(v.duration_ms)})` : ""}`).join(", ") : "rien"}`,
    `Notes staff : ${notes} (\`/sysp\` notes) · Malus actifs : ${malus.length ? malus.join(", ") : "aucun"}`,
  ].join("\n").slice(0, 1900);
}

export function astreinteMembers(guildId) {
  return safe(() => db.prepare("SELECT member_id FROM garde_astreinte WHERE guild_id=?").all(guildId).map((r) => r.member_id), []);
}

async function freezeChannel(channel, minutes, actorId) {
  const everyone = channel.guild.roles.everyone;
  const overwrite = channel.permissionOverwrites?.cache?.get(everyone.id);
  const previousSend = overwrite ? (overwrite.allow.has(P.SendMessages) ? "allow" : overwrite.deny.has(P.SendMessages) ? "deny" : "neutral") : "neutral";
  db.prepare("INSERT OR REPLACE INTO garde_frozen_channels VALUES (?,?,?,?,?,?,?)").run(channel.guild.id, channel.id, Number(channel.rateLimitPerUser ?? 0), overwrite ? 1 : 0, previousSend, Date.now() + minutes * 60_000, actorId);
  await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: `/garde geler (${minutes} min)` });
  await channel.setRateLimitPerUser?.(30, "/garde geler").catch(() => {});
}
export async function unfreezeChannel(guild, row) {
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  db.prepare("DELETE FROM garde_frozen_channels WHERE channel_id=?").run(row.channel_id);
  if (!channel) return false;
  const everyone = guild.roles.everyone;
  const value = row.previous_send === "allow" ? true : row.previous_send === "deny" ? false : null;
  await channel.permissionOverwrites.edit(everyone, { SendMessages: value }, { reason: "Fin du gel" }).catch(() => {});
  await channel.setRateLimitPerUser?.(row.previous_slowmode, "Fin du gel").catch(() => {});
  await channel.send?.({ content: "🧊 Fin du gel : le salon est rouvert.", allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
export async function expireFrozenChannels(client) {
  const rows = safe(() => db.prepare("SELECT * FROM garde_frozen_channels WHERE until<=?").all(Date.now()), []);
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (guild) await unfreezeChannel(guild, row); else db.prepare("DELETE FROM garde_frozen_channels WHERE channel_id=?").run(row.channel_id);
  }
  return rows.length;
}

async function runAppeal({ channel, actor, target, sanction, reason, settings, minutes = 10 }) {
  const roleId = settings?.sysPlus?.roleId;
  const vote = await channel.send({ content: `🗳️ **Appel SYS+** demandé par <@${actor.id}> : **${sanction}** pour <@${target.id}>.\nMotif : ${reason}\nSYS+, votez en ${minutes} min : ✅ pour, ❌ contre (2 votes minimum).`, allowedMentions: roleId ? { roles: [roleId] } : { parse: [] } });
  await vote.react("✅").catch(() => {});
  await vote.react("❌").catch(() => {});
  setTimeout(async () => {
    const fresh = await vote.fetch().catch(() => vote);
    const count = async (emoji) => {
      const users = await fresh.reactions?.cache?.get(emoji)?.users.fetch().catch(() => null);
      if (!users) return 0;
      let n = 0;
      for (const user of users.values()) {
        if (user.bot || user.id === target.id) continue;
        const member = await channel.guild.members.fetch(user.id).catch(() => null);
        if (member && isSysPlus(member, roleId ?? null)) n++;
      }
      return n;
    };
    const pour = await count("✅");
    const contre = await count("❌");
    const outcome = appealOutcome(pour, contre);
    try { recordSysPlusAudit(channel.guild.id, actor.id, "garde.appel", target.id, { sanction, pour, contre, outcome }); } catch { /* best effort */ }
    const text = outcome === "quorum" ? `pas assez de votes (${pour + contre})` : outcome === "pour" ? `**accordée** (${pour} pour, ${contre} contre)` : `**refusée** (${pour} pour, ${contre} contre)`;
    await channel.send({ content: `🗳️ Appel sur ${sanction} pour <@${target.id}> : ${text}. Le résultat est gardé dans l'audit SYS+.`, allowedMentions: { parse: [] } }).catch(() => {});
  }, minutes * 60_000).unref?.();
}

async function execute(interaction, settings) {
  const guild = interaction.guild;
  const actor = await requireSysPlus(interaction, settings);
  const o = interaction.options;
  const sub = o.getSubcommand();
  if (sub === "moi") return moiText(guild.id, actor.id);
  if (sub === "releve") return releveText(guild, Math.min(72, Math.max(1, o.getInteger("heures") ?? 12)));
  if (sub === "bilan") return moiText(guild.id, actor.id).replace("Ton tableau SYS+", "Ton bilan de la semaine");
  if (sub === "astreinte") {
    const etat = o.getString("etat", true);
    if (etat === "on") db.prepare("INSERT OR REPLACE INTO garde_astreinte VALUES (?,?,?)").run(guild.id, actor.id, Date.now());
    if (etat === "off") db.prepare("DELETE FROM garde_astreinte WHERE guild_id=? AND member_id=?").run(guild.id, actor.id);
    const list = astreinteMembers(guild.id);
    return `${etat === "on" ? "🟢 Tu es d'astreinte : les alertes de sécurité te mentionneront." : etat === "off" ? "⚪ Astreinte terminée." : "📟 Astreinte"}\nEn astreinte : ${list.length ? list.map((id) => `<@${id}>`).join(", ") : "personne"}`;
  }
  if (sub === "enquete" || sub === "bareme") {
    const user = o.getUser("membre", true);
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) throw new GardeError("❌ Ce membre n'est pas sur le serveur.");
    if (sub === "enquete") return enqueteText(guild, member);
    const cases = safe(() => db.prepare("SELECT action, created_at FROM moderation_cases WHERE guild_id=? AND user_id=?").all(guild.id, member.id), []);
    const next = nextSanction(cases);
    return `⚖️ Barème pour <@${member.id}> : ${next.count} sanction(s) sur 90 jours → prochaine proposée **${next.action}** (${next.detail}). C'est une proposition : la décision reste la tienne.`;
  }
  if (sub === "demande-quota") {
    const amount = o.getInteger("nombre", true);
    const reason = String(o.getString("raison", true)).replace(/@/g, "＠").slice(0, 300);
    const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
    const text = `📈 **Demande de quota** de <@${actor.id}> sur **${guild.name}** : +${amount} sanction(s).\nRaison : ${reason}\nPour accepter : \`/quota\` sur le serveur. Sans réponse, rien n'est accordé.`;
    if (ownerId) { const owner = await interaction.client.users.fetch(ownerId).catch(() => null); await owner?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {}); }
    await sendCentralLog(guild, settings, systemLogEmbed({ category: "moderation", title: "📈 Demande de quota", description: text, color: 0x38bdf8 })).catch(() => {});
    try { recordSysPlusAudit(guild.id, actor.id, "garde.demande_quota", null, { amount }); } catch { /* best effort */ }
    return "📈 Demande envoyée à l'owner. Rien n'est accordé sans lui.";
  }
  if (sub === "appel") {
    const user = o.getUser("membre", true);
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) throw new GardeError("❌ Ce membre n'est pas sur le serveur.");
    if (!interaction.channel?.send) throw new GardeError("Lance l'appel dans un salon textuel du staff.");
    await runAppeal({ channel: interaction.channel, actor, target, sanction: o.getString("sanction", true), reason: String(o.getString("raison", true)).replace(/@/g, "＠").slice(0, 300), settings });
    return "🗳️ Appel ouvert pour 10 minutes.";
  }
  if (sub === "geler") {
    const channel = o.getChannel("salon") ?? interaction.channel;
    const minutes = Math.min(120, Math.max(1, o.getInteger("minutes") ?? 10));
    if (!channel?.permissionOverwrites) throw new GardeError("Choisis un salon textuel.");
    if (!channel.permissionsFor(actor)?.has(P.ManageMessages)) throw new GardeError("⛔ Il te faut « Gérer les messages » dans ce salon.");
    if (!channel.permissionsFor(guild.members.me)?.has(P.ManageChannels)) throw new GardeError("❌ Il me faut « Gérer les salons » sur ce salon.");
    await freezeChannel(channel, minutes, actor.id);
    await channel.send?.({ content: `🧊 Salon gelé ${minutes} min par le staff. On souffle un coup.`, allowedMentions: { parse: [] } }).catch(() => {});
    try { recordSysPlusAudit(guild.id, actor.id, "garde.geler", null, { channelId: channel.id, minutes }); } catch { /* best effort */ }
    return `🧊 <#${channel.id}> gelé pour ${minutes} min, rouverture automatique.`;
  }
  if (sub === "planning") {
    const dispos = o.getString("dispos");
    if (dispos) {
      db.prepare("INSERT OR REPLACE INTO garde_planning VALUES (?,?,?,?)").run(guild.id, actor.id, String(dispos).replace(/[@`*_~|]/g, "").slice(0, 120), Date.now());
      return `🗓️ Tes dispos sont enregistrées : ${String(dispos).replace(/[@`*_~|]/g, "").slice(0, 120)}`;
    }
    const rows = safe(() => db.prepare("SELECT member_id, dispos, updated_at FROM garde_planning WHERE guild_id=? ORDER BY updated_at DESC LIMIT 40").all(guild.id), []);
    return rows.length ? `🗓️ **Planning du staff**\n${rows.map((r) => `• <@${r.member_id}> : ${r.dispos} (${ts(r.updated_at)})`).join("\n")}`.slice(0, 1900) : "Personne n'a encore indiqué ses dispos (`/garde planning dispos:`).";
  }
  throw new GardeError("Sous-commande inconnue.");
}

export async function handleGardeInteraction(interaction, settings = {}, record = () => {}) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "garde") return false;
  if (!interaction.inGuild()) { await interaction.reply({ content: "Seulement dans un serveur.", ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: true });
  try { await interaction.editReply({ content: await execute(interaction, settings), allowedMentions: { parse: [] } }); }
  catch (error) {
    if (!(error instanceof GardeError)) record("garde_error");
    await interaction.editReply({ content: error instanceof GardeError ? error.message : "❌ Action impossible : vérifie mes permissions.", allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

/** Sunday-evening private report to every SYS+ (once per week and server). */
export async function sendWeeklyStaffReports(client, settingsByGuild, { now = Date.now(), guildIds = null } = {}) {
  const week = Math.floor(now / (7 * 86_400_000));
  let sent = 0;
  for (const guild of client.guilds.cache.values()) {
    if (guildIds && !guildIds.includes(guild.id)) continue;
    if (safe(() => db.prepare("SELECT 1 FROM garde_weekly_sent WHERE guild_id=? AND week=?").get(guild.id, week), null)) continue;
    db.prepare("INSERT OR IGNORE INTO garde_weekly_sent VALUES (?,?)").run(guild.id, week);
    const roleId = settingsByGuild?.[guild.id]?.sysPlus?.roleId;
    if (!roleId) continue;
    const role = guild.roles.cache.get(roleId);
    for (const member of role?.members?.values?.() ?? []) {
      if (member.user.bot) continue;
      await member.send({ content: moiText(guild.id, member.id).replace("Ton tableau SYS+", `Ton bilan de la semaine sur ${guild.name}`), allowedMentions: { parse: [] } }).catch(() => {});
      sent++;
    }
  }
  return sent;
}
export function msUntilWeeklyReport(now = Date.now()) { return nextWeeklyReport(now) - now; }

/** Pure: temporary sanctions ending within `aheadMs` that still need a reminder. */
export function sanctionsEndingSoon(rows, { now = Date.now(), aheadMs = 5 * 60_000, sent = new Set() } = {}) {
  const out = [];
  for (const row of rows) {
    if (sent.has(row.id)) continue;
    let details = {};
    try { details = JSON.parse(row.details_json ?? "{}") ?? {}; } catch { continue; }
    const ms = Number(details.durationMs ?? (details.durationSeconds ? details.durationSeconds * 1000 : 0));
    if (!ms) continue;
    const endsAt = Number(row.created_at) + ms;
    if (endsAt > now && endsAt - now <= aheadMs) out.push({ ...row, endsAt });
  }
  return out;
}

/** Reminds the moderator 5 min before a temporary mute/ban ends (one DM per sanction). */
export async function sendSanctionEndReminders(client, { now = Date.now() } = {}) {
  const rows = safe(() => db.prepare("SELECT id, guild_id, user_id, moderator_id, action, details_json, created_at FROM moderation_cases WHERE action IN ('mute','ban') AND created_at > ? ORDER BY id DESC LIMIT 500").all(now - 30 * 86_400_000), []);
  const sent = new Set(safe(() => db.prepare("SELECT case_id FROM garde_end_reminders WHERE sent_at > ?").all(now - 31 * 86_400_000).map((r) => r.case_id), []));
  let count = 0;
  for (const row of sanctionsEndingSoon(rows, { now, sent })) {
    db.prepare("INSERT OR IGNORE INTO garde_end_reminders VALUES (?,?)").run(row.id, now);
    const guild = client.guilds.cache.get(row.guild_id);
    const moderator = await client.users.fetch(row.moderator_id).catch(() => null);
    if (!guild || !moderator) continue;
    await moderator.send({ content: `⏰ **${guild.name}** : ${row.action === "ban" ? "le ban temporaire" : "le mute"} de <@${row.user_id}> (dossier #${row.id}) se termine <t:${Math.floor(row.endsAt / 1000)}:R>. Pour prolonger, refais la sanction ; sinon rien à faire.`, allowedMentions: { parse: [] } }).catch(() => {});
    count++;
  }
  return count;
}
