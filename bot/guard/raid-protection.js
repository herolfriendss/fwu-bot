// FWU V2 — GUARD : piège BLR, mode raid, dérive de permissions, bot/webhook ajouté,
// token divulgué, double authentification, audit de sécurité (scan) et verrouillage rapide (panic).
//
// Règle : un détecteur probabiliste (rafale d'arrivées, dérive, bot ajouté) produit une
// alerte et des mesures réversibles (fermeture des invitations, quarantaine des comptes
// récents), jamais une sanction irréversible. Le piège est déterministe (écrire dans un
// salon interdit) : il pose un BLR, annulable par le bouton « Pardon ».
import { AuditLogEvent, ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { logEvent } from "../log-events.js";
import { privilegedPermissionNames } from "../role-grant-guard.js";
import { canManageBlr, setBlr, liftBlr } from "../blr-commands.js";
import { isBlr } from "../blr.js";
import { lockdownState, startLockdown } from "./shield.js";
import { nightRaidThreshold } from "./night-mode.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS guard_trap_channels (
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS guard_raid_state (
    guild_id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0,
    since INTEGER, last_join_at INTEGER, invites_closed INTEGER NOT NULL DEFAULT 0,
    threshold INTEGER NOT NULL DEFAULT 10, window_seconds INTEGER NOT NULL DEFAULT 30, calm_minutes INTEGER NOT NULL DEFAULT 15
  );
`);

const ownerOf = (env = process.env) => parsePndOwnerId(env.PND_OWNER_DISCORD_ID);

/** Administrateur Discord, propriétaire du serveur ou OWNER. */
export function isGuardAdmin(member, env = process.env) {
  if (!member?.id) return false;
  if (member.id === ownerOf(env) || member.id === member.guild?.ownerId) return true;
  return Boolean(member.permissions?.has?.(P.Administrator));
}

// ------------------------------------------------------------------ piège ----

export function trapChannels(guildId) {
  return db.prepare("SELECT channel_id FROM guard_trap_channels WHERE guild_id = ?").all(String(guildId)).map((row) => row.channel_id);
}
export function addTrapChannel(guildId, channelId, createdBy = null, now = Date.now()) {
  db.prepare("INSERT OR IGNORE INTO guard_trap_channels(guild_id, channel_id, created_by, created_at) VALUES (?, ?, ?, ?)").run(String(guildId), String(channelId), createdBy, now);
}
export function removeTrapChannel(guildId, channelId) {
  return Number(db.prepare("DELETE FROM guard_trap_channels WHERE guild_id = ? AND channel_id = ?").run(String(guildId), String(channelId)).changes);
}

/** Exemptés du piège : bots, OWNER, propriétaire, staff (Gérer les messages / Admin), SYS+, ADMIN+, WHITELIST. */
export function isTrapExempt(member, settings = null, env = process.env) {
  if (!member) return false;
  if (member.user?.bot || member.id === ownerOf(env) || member.id === member.guild?.ownerId) return true;
  if (member.permissions?.has?.(P.Administrator) || member.permissions?.has?.(P.ManageMessages) || member.permissions?.has?.(P.ModerateMembers)) return true;
  const roles = [settings?.sysPlus?.roleId, settings?.adminPlus?.roleId, settings?.sysPlus?.whitelistRoleId].filter(Boolean);
  return roles.some((roleId) => member.roles?.cache?.has?.(roleId));
}

/** Supprime les messages récents (1 h) de l'auteur dans les salons texte (15 au plus). */
async function purgeRecentMessages(guild, userId, now = Date.now()) {
  let deleted = 0;
  const channels = [...(guild.channels?.cache?.values?.() ?? [])].filter((c) => c.type === ChannelType.GuildText && typeof c.messages?.fetch === "function").slice(0, 15);
  for (const channel of channels) {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const mine = [...(messages?.values?.() ?? [])].filter((m) => m.author?.id === userId && now - m.createdTimestamp < 3_600_000);
    if (!mine.length) continue;
    const ok = await channel.bulkDelete(mine.map((m) => m.id), true).then((r) => r?.size ?? mine.length).catch(() => 0);
    deleted += ok;
  }
  return deleted;
}

/**
 * messageCreate (GUARD) : un non-exempté qui écrit dans un salon piège passe en BLR,
 * ses messages récents sont supprimés, le staff reçoit une alerte avec « Pardon ».
 * Retourne une ligne de journal, ou null.
 */
export async function springBlrTrap(message, settings = null, { env = process.env } = {}) {
  const guild = message?.guild;
  if (!guild || !message.author || message.webhookId || message.author.bot) return null;
  if (!trapChannels(guild.id).includes(message.channelId)) return null;
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member || isTrapExempt(member, settings, env)) return null;
  await message.delete().catch(() => {});
  const purged = await purgeRecentMessages(guild, member.id);
  const bot = guild.members?.me ?? { id: guild.client?.user?.id ?? "0" };
  const result = isBlr(guild.id, member.id)
    ? { ok: true, caseNumber: null }
    : await setBlr({ guild, actor: bot, target: member, reason: "Message dans un salon piège", settings, env, automatic: true });
  await logEvent(guild, settings, {
    category: "security", action: "trap_caught", severity: "critical", targetId: member.id, caseNumber: result.caseNumber ?? null,
    details: `Salon piège : <#${message.channelId}>\nMessages supprimés : ${purged + 1}\nBLR : ${result.ok ? "posé" : result.message}`,
  }, {
    components: [{ type: 1, components: [{ type: 2, style: 2, label: "Pardon", emoji: { name: "🕊️" }, custom_id: `trap:pardon:${guild.id}:${member.id}` }] }],
  }).catch(() => {});
  return `🪤 <@${member.id}> a écrit dans un salon piège : BLR ${result.ok ? "posé" : "impossible"}, ${purged + 1} message(s) supprimé(s).`;
}

/** Bouton « Pardon » (dans le hub ou le serveur) : BLR levé avec restauration. Staff du serveur source. */
export async function handleTrapPardon(interaction, { client, getSettings = () => null, env = process.env } = {}) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith("trap:pardon:")) return false;
  const [, , guildId, userId] = interaction.customId.split(":");
  const guild = client?.guilds?.cache?.get?.(guildId);
  if (!guild) { await interaction.reply({ content: "⚠️ Serveur source introuvable.", ephemeral: true }).catch(() => {}); return true; }
  const clicker = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  // Lever un BLR reste réservé à l'OWNER et aux paliers 0 % et 1 % (aucune dérogation par le bouton).
  if (!clicker || !(await canManageBlr(clicker, { env }))) { await interaction.reply({ content: "⛔ Le pardon (levée du BLR) est réservé à l'OWNER et aux paliers 0 % et 1 %.", ephemeral: true }).catch(() => {}); return true; }
  const target = await guild.members.fetch(userId).catch(() => null);
  const result = await liftBlr({ guild, actorId: clicker.id, target, targetId: userId, restore: true, reason: "Pardon (salon piège)", settings: getSettings(guildId), env });
  await interaction.reply({ content: result.ok ? `🕊️ Pardon accordé à <@${userId}> : ${result.message}` : result.message, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

// -------------------------------------------------------------- mode raid ----

export function raidConfig(guildId) {
  const row = db.prepare("SELECT * FROM guard_raid_state WHERE guild_id = ?").get(String(guildId));
  return {
    active: Boolean(row?.active), manual: Boolean(row?.manual), since: row?.since ?? null, lastJoinAt: row?.last_join_at ?? null,
    invitesClosed: Boolean(row?.invites_closed), threshold: row?.threshold ?? 10, windowSeconds: row?.window_seconds ?? 30, calmMinutes: row?.calm_minutes ?? 15,
  };
}
export function isRaidActive(guildId) {
  return raidConfig(guildId).active;
}
export function saveRaidSettings(guildId, { threshold, windowSeconds, calmMinutes }) {
  const t = Number(threshold); const w = Number(windowSeconds); const c = Number(calmMinutes);
  if (!(t >= 3 && t <= 100) || !(w >= 5 && w <= 600) || !(c >= 1 && c <= 240)) throw new Error("Seuils : 3 à 100 arrivées, 5 à 600 s, calme de 1 à 240 min.");
  db.prepare(`INSERT INTO guard_raid_state(guild_id, threshold, window_seconds, calm_minutes) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET threshold = excluded.threshold, window_seconds = excluded.window_seconds, calm_minutes = excluded.calm_minutes`).run(String(guildId), t, w, c);
}

function writeRaid(guildId, patch) {
  const current = raidConfig(guildId);
  const next = { ...current, ...patch };
  db.prepare(`INSERT INTO guard_raid_state(guild_id, active, manual, since, last_join_at, invites_closed, threshold, window_seconds, calm_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET active = excluded.active, manual = excluded.manual,
    since = excluded.since, last_join_at = excluded.last_join_at, invites_closed = excluded.invites_closed`)
    .run(String(guildId), next.active ? 1 : 0, next.manual ? 1 : 0, next.since, next.lastJoinAt, next.invitesClosed ? 1 : 0, next.threshold, next.windowSeconds, next.calmMinutes);
}

/** Active / coupe le mode raid : invitations fermées puis rouvertes, alerte typée. */
export async function setRaidMode(guild, on, { manual = false, actorId = null, settings = null, reason = null, now = Date.now() } = {}) {
  const state = raidConfig(guild.id);
  if (on === state.active) return { changed: false, state };
  let invitesClosed = state.invitesClosed;
  if (on && typeof guild.disableInvites === "function") invitesClosed = await guild.disableInvites(true).then(() => true).catch(() => false);
  if (!on && state.invitesClosed && typeof guild.disableInvites === "function") await guild.disableInvites(false).catch(() => {});
  writeRaid(guild.id, { active: on, manual, since: on ? now : null, invitesClosed: on ? invitesClosed : false, lastJoinAt: on ? now : state.lastJoinAt });
  await logEvent(guild, settings, {
    category: "security", action: on ? "raid_on" : "raid_off", severity: on ? "critical" : "notice", actorId,
    details: on
      ? `${reason ?? (manual ? "Activé à la main." : "Afflux d'arrivées détecté.")}\nInvitations : ${invitesClosed ? "fermées" : "inchangées (permission manquante)"}\nComptes récents : quarantaine à l'arrivée.`
      : `${reason ?? (manual ? "Coupé à la main." : "Période calme : sortie automatique.")}`,
  }).catch(() => {});
  return { changed: true, state: raidConfig(guild.id) };
}

const joins = new Map();
/** guildMemberAdd : compte les arrivées ; au-delà du seuil, mode raid automatique. */
export async function recordJoinForRaid(member, { settings = null, now = Date.now() } = {}) {
  const guild = member?.guild;
  if (!guild || member.user?.bot) return false;
  const base = raidConfig(guild.id);
  // Mode nuit : seuil d'arrivées abaissé pendant la plage programmée.
  const night = nightRaidThreshold(guild.id);
  const config = night != null && night < base.threshold ? { ...base, threshold: night } : base;
  const recent = (joins.get(guild.id) ?? []).filter((at) => now - at < config.windowSeconds * 1000);
  recent.push(now);
  joins.set(guild.id, recent);
  if (config.active) { writeRaid(guild.id, { lastJoinAt: now }); return true; }
  if (recent.length >= config.threshold) {
    await setRaidMode(guild, true, { settings, now, reason: `${recent.length} arrivées en ${config.windowSeconds} s.` });
    return true;
  }
  return false;
}

/** Sortie automatique après une période calme (mode automatique seulement). */
export async function raidAutoExit(client, { getSettings = () => null, now = Date.now() } = {}) {
  const rows = db.prepare("SELECT guild_id FROM guard_raid_state WHERE active = 1 AND manual = 0").all();
  for (const row of rows) {
    const config = raidConfig(row.guild_id);
    if (now - (config.lastJoinAt ?? config.since ?? now) < config.calmMinutes * 60_000) continue;
    const guild = client.guilds.cache.get(row.guild_id);
    if (guild) await setRaidMode(guild, false, { settings: getSettings(row.guild_id), now });
  }
}

// ------------------------------------------------------ dérive et ajouts ----

/** Permissions sensibles gagnées par un rôle existant. */
export function permissionDrift(oldPermissions, newPermissions) {
  const before = new Set(privilegedPermissionNames(oldPermissions));
  return privilegedPermissionNames(newPermissions).filter((name) => !before.has(name));
}

async function auditExecutor(guild, type, targetId, now = Date.now()) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((e) => (!targetId || e.target?.id === targetId) && now - e.createdTimestamp < 15_000);
    return entry?.executor?.id ?? null;
  } catch {
    return null;
  }
}

/** roleUpdate : alerte quand un rôle gagne Administrateur, Gérer les rôles… */
export async function handleRoleDrift(oldRole, newRole, { settings = null } = {}) {
  const gained = permissionDrift(oldRole?.permissions, newRole?.permissions);
  if (!gained.length || !newRole?.guild) return null;
  const executor = await auditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  await logEvent(newRole.guild, settings, {
    category: "permissions", action: "permission_drift", severity: "critical", actorId: executor,
    details: `Rôle <@&${newRole.id}> : permissions gagnées ${gained.join(", ")}.\nPorteurs : ${newRole.members?.size ?? "?"}.`,
  }).catch(() => {});
  return gained;
}

/** Bot ajouté : signalé (aucune exclusion automatique) tant que l'OWNER n'a pas validé. */
export async function handleBotAdded(member, { settings = null, approved = () => false } = {}) {
  if (!member?.user?.bot || approved(member.id)) return false;
  const executor = await auditExecutor(member.guild, AuditLogEvent.BotAdd, member.id);
  await logEvent(member.guild, settings, {
    category: "security", action: "bot_added", severity: "critical", actorId: executor, targetId: member.id,
    details: `Bot ajouté : <@${member.id}>. À valider par l'OWNER (vérifier ses permissions).`,
  }).catch(() => {});
  return true;
}

/** Webhook créé (hors bots de l'écosystème) : signalé. */
export async function handleWebhookCreated(channel, { settings = null, trustedIds = new Set() } = {}) {
  if (!channel?.guild) return false;
  const executor = await auditExecutor(channel.guild, AuditLogEvent.WebhookCreate, null);
  if (!executor || trustedIds.has(executor)) return false;
  await logEvent(channel.guild, settings, {
    category: "webhooks", action: "webhook_created", severity: "warning", actorId: executor,
    details: `Webhook créé dans <#${channel.id}>.`,
  }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------- tokens ----

const TOKEN_PATTERN = /\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/;
export function containsBotToken(text) {
  return TOKEN_PATTERN.test(String(text ?? ""));
}

/** Message contenant un token de bot : supprimé et signalé (le token n'est jamais recopié). */
export async function handleTokenLeak(message, { settings = null } = {}) {
  if (!message?.guild || !containsBotToken(message.content)) return false;
  await message.delete().catch(() => {});
  await logEvent(message.guild, settings, {
    category: "security", action: "token_leak", severity: "critical", targetId: message.author?.id,
    details: `Un token de bot a été posté dans <#${message.channelId}> puis supprimé. Régénère ce token dans le Developer Portal.`,
  }).catch(() => {});
  return true;
}

// ------------------------------------------------------------- A2F, scan ----

/** Alerte si la double authentification n'est pas exigée pour la modération. */
export async function checkMfa(guild, { settings = null } = {}) {
  if (!guild || Number(guild.mfaLevel ?? 0) !== 0) return false;
  await logEvent(guild, settings, {
    category: "security", action: "mfa_not_required", severity: "warning",
    details: "La double authentification n'est pas exigée pour la modération (Paramètres du serveur → Sécurité).",
  }).catch(() => {});
  return true;
}

/** Audit de sécurité : score sur 100 et constats. Ne modifie rien. */
export function scanGuild(guild, { automodRuleCount = null } = {}) {
  const findings = [];
  let score = 100;
  const penalty = (points, text) => { score -= points; findings.push(`−${points} ${text}`); };
  const everyone = guild.roles?.cache?.get?.(guild.id);
  const everyoneDanger = privilegedPermissionNames(everyone?.permissions);
  if (everyoneDanger.length) penalty(25, `@everyone porte des permissions sensibles (${everyoneDanger.join(", ")}).`);
  const roles = [...(guild.roles?.cache?.values?.() ?? [])].filter((r) => r.id !== guild.id);
  const admins = roles.filter((r) => privilegedPermissionNames(r.permissions).includes("Administrator"));
  if (admins.length > 2) penalty(Math.min(15, (admins.length - 2) * 5), `${admins.length} rôles ont Administrateur.`);
  const botsAdmin = [...(guild.members?.cache?.values?.() ?? [])].filter((m) => m.user?.bot && m.permissions?.has?.(P.Administrator) && m.id !== guild.members?.me?.id);
  if (botsAdmin.length) penalty(Math.min(20, botsAdmin.length * 10), `${botsAdmin.length} bot(s) tiers avec Administrateur.`);
  const mentionableDanger = roles.filter((r) => r.mentionable && privilegedPermissionNames(r.permissions).length);
  if (mentionableDanger.length) penalty(5, `${mentionableDanger.length} rôle(s) staff mentionnable(s) par tous.`);
  if (Number(guild.mfaLevel ?? 0) === 0) penalty(15, "Double authentification non exigée pour la modération.");
  if (Number(guild.verificationLevel ?? 0) < 2) penalty(10, "Niveau de vérification faible (moins de « moyen »).");
  if (Number(guild.explicitContentFilter ?? 0) === 0) penalty(5, "Filtre de contenu explicite désactivé.");
  if (!trapChannels(guild.id).length) penalty(5, "Aucun salon piège.");
  // A bot can only sanction members whose highest role is below its own.
  const me = guild.members?.me;
  const myTop = Number(me?.roles?.highest?.position ?? -1);
  if (myTop >= 0) {
    const above = roles.filter((r) => !r.managed && Number(r.position) >= myTop && privilegedPermissionNames(r.permissions).length);
    if (above.length) penalty(Math.min(15, above.length * 5), `${above.length} rôle(s) staff au-dessus de mon rôle : je ne peux pas sanctionner ceux qui les portent. Monte mon rôle dans Paramètres → Rôles.`);
  }
  // AutoMod natif : tourne chez Discord, protège même quand tous les bots sont tombés.
  if (automodRuleCount === 0) penalty(10, "Aucune règle AutoMod native de Discord (protection qui marche même sans bot).");
  return { score: Math.max(0, score), findings, admins: admins.length };
}

/** Verrouillage rapide : salons fermés à l'écriture (gel existant) + mode raid manuel. */
export async function panic(guild, { actorId, settings = null, reason = "Verrouillage d'urgence" } = {}) {
  let locked = 0;
  if (!lockdownState(guild.id)) locked = await startLockdown(guild, { reason: `GUARD : ${reason}`, startedBy: actorId });
  await setRaidMode(guild, true, { manual: true, actorId, settings, reason });
  return { locked };
}
