// FWU GUARD — anti-nuke.
//
// Watches destructive actions (channel/role deletion, bans, kicks, webhook creation).
// When one executor exceeds the threshold inside the window, GUARD:
//   1. strips that executor's roles that carry dangerous permissions (a foreign bot is kicked);
//   2. restores what it destroyed in the window (channels, roles, bans);
//   3. alerts the staff in the logs.
// Never acts on: the OWNER, the server owner, the trusted list, and the FWU bots themselves.
// Enabled by default (threshold 3 actions / 60 s). Config: /antinuke (OWNER / server owner).
import { AuditLogEvent, ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";

export const ANTINUKE_DEFAULTS = Object.freeze({ enabled: true, threshold: 3, windowSeconds: 60 });
export const DANGEROUS_PERMISSIONS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];
export const NUKE_ACTIONS = Object.freeze({
  channelDelete: { audit: AuditLogEvent.ChannelDelete, label: "suppression de salon" },
  roleDelete: { audit: AuditLogEvent.RoleDelete, label: "suppression de rôle" },
  ban: { audit: AuditLogEvent.MemberBanAdd, label: "bannissement" },
  kick: { audit: AuditLogEvent.MemberKick, label: "expulsion" },
  webhookCreate: { audit: AuditLogEvent.WebhookCreate, label: "création de webhook" },
});

db.exec(`
  CREATE TABLE IF NOT EXISTS antinuke_config (
    guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, threshold INTEGER NOT NULL,
    window_seconds INTEGER NOT NULL, trusted_json TEXT NOT NULL DEFAULT '[]',
    updated_by TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fwu_bot_identities (
    profile TEXT PRIMARY KEY, user_id TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
`);

export function getAntiNukeConfig(guildId) {
  const row = db.prepare("SELECT enabled, threshold, window_seconds, trusted_json FROM antinuke_config WHERE guild_id=?").get(guildId);
  if (!row) return { ...ANTINUKE_DEFAULTS, trusted: [] };
  let trusted = [];
  try { trusted = JSON.parse(row.trusted_json); } catch { trusted = []; }
  return { enabled: Boolean(row.enabled), threshold: row.threshold, windowSeconds: row.window_seconds, trusted: Array.isArray(trusted) ? trusted : [] };
}

export function saveAntiNukeConfig(guildId, patch, actorId) {
  const next = { ...getAntiNukeConfig(guildId), ...patch };
  next.threshold = Math.min(20, Math.max(2, Math.trunc(Number(next.threshold) || ANTINUKE_DEFAULTS.threshold)));
  next.windowSeconds = Math.min(600, Math.max(10, Math.trunc(Number(next.windowSeconds) || ANTINUKE_DEFAULTS.windowSeconds)));
  next.trusted = [...new Set(next.trusted.filter((id) => /^\d{5,25}$/.test(String(id))))].slice(0, 50);
  db.prepare(`INSERT INTO antinuke_config(guild_id,enabled,threshold,window_seconds,trusted_json,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, threshold=excluded.threshold, window_seconds=excluded.window_seconds,
    trusted_json=excluded.trusted_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(guildId, next.enabled ? 1 : 0, next.threshold, next.windowSeconds, JSON.stringify(next.trusted), actorId ?? null, Date.now());
  return next;
}

/** Each FWU bot records its Discord id: the others never treat it as an attacker. */
export function registerBotIdentity(profile, userId) {
  if (!profile || !userId) return;
  db.prepare("INSERT INTO fwu_bot_identities(profile,user_id,updated_at) VALUES(?,?,?) ON CONFLICT(profile) DO UPDATE SET user_id=excluded.user_id, updated_at=excluded.updated_at").run(profile, userId, Date.now());
}
export function fwuBotIds() {
  return new Set(db.prepare("SELECT user_id FROM fwu_bot_identities").all().map((row) => row.user_id));
}

/** Pure: is this executor exempt from the anti-nuke? */
export function isExempt(executorId, { guildOwnerId, ownerId, trusted = [], botIds = new Set(), selfId = null }) {
  if (!executorId) return true;
  return executorId === ownerId || executorId === guildOwnerId || executorId === selfId || trusted.includes(executorId) || botIds.has(executorId);
}

/** Sliding-window counter per guild+executor. Returns true when the threshold is reached. */
export function createNukeTracker(now = () => Date.now()) {
  const events = new Map();
  return {
    hit(guildId, executorId, item, { threshold, windowSeconds }) {
      const key = `${guildId}:${executorId}`;
      const since = now() - windowSeconds * 1000;
      const list = (events.get(key) ?? []).filter((event) => event.at >= since);
      list.push({ at: now(), item });
      events.set(key, list);
      return { triggered: list.length >= threshold, recent: list.map((event) => event.item) };
    },
    clear(guildId, executorId) { events.delete(`${guildId}:${executorId}`); },
  };
}

export function channelSnapshot(channel) {
  return {
    kind: "channel",
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null,
    position: channel.rawPosition ?? channel.position ?? 0,
    topic: channel.topic ?? null,
    nsfw: Boolean(channel.nsfw),
    bitrate: channel.bitrate ?? undefined,
    userLimit: channel.userLimit ?? undefined,
    rateLimitPerUser: channel.rateLimitPerUser ?? undefined,
    overwrites: [...(channel.permissionOverwrites?.cache?.values?.() ?? [])].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
  };
}

export function roleSnapshot(role) {
  return { kind: "role", id: role.id, name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions.bitfield.toString(), position: role.position };
}

async function findExecutor(guild, auditType, targetId) {
  const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 }).catch(() => null);
  const entry = [...(logs?.entries?.values?.() ?? [])].find((e) => (!targetId || e.target?.id === targetId || e.targetId === targetId) && Date.now() - e.createdTimestamp < 15_000);
  return entry?.executor ?? (entry?.executorId ? { id: entry.executorId } : null);
}

async function restore(guild, items, reason) {
  let restored = 0;
  for (const item of items) {
    try {
      if (item.kind === "channel") {
        await guild.channels.create({
          name: item.name, type: item.type, parent: item.parentId ?? undefined, topic: item.topic ?? undefined, nsfw: item.nsfw,
          bitrate: item.type === ChannelType.GuildVoice ? item.bitrate : undefined,
          userLimit: item.type === ChannelType.GuildVoice ? item.userLimit : undefined,
          rateLimitPerUser: item.rateLimitPerUser, permissionOverwrites: item.overwrites, position: item.position, reason,
        });
        restored += 1;
      } else if (item.kind === "role") {
        await guild.roles.create({ name: item.name, color: item.color, hoist: item.hoist, mentionable: item.mentionable, permissions: BigInt(item.permissions), reason });
        restored += 1;
      } else if (item.kind === "ban") {
        await guild.bans.remove(item.userId, reason);
        restored += 1;
      }
    } catch { /* keep going: restore what we can */ }
  }
  return restored;
}

async function neutralize(guild, executorId) {
  const member = await guild.members.fetch({ user: executorId, force: true }).catch(() => null);
  if (!member) return "absent du serveur";
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (member.user?.bot) {
    if (member.kickable) { await member.kick("Anti-nuke FWU : actions destructrices en masse"); return "bot expulsé"; }
    return "bot non expulsable (rôle trop haut)";
  }
  const dangerous = [...member.roles.cache.values()].filter((role) => role.id !== guild.id && !role.managed
    && role.position < me.roles.highest.position && DANGEROUS_PERMISSIONS.some((flag) => role.permissions.has(flag)));
  if (!dangerous.length) return "aucun rôle dangereux retirable";
  await member.roles.remove(dangerous, "Anti-nuke FWU : actions destructrices en masse");
  return `${dangerous.length} rôle(s) dangereux retiré(s)`;
}

/**
 * Wire this into the GUARD process. `report(guild, embed)` publishes an alert,
 * `record(code)` feeds the status page.
 */
export function createAntiNuke({ client, report = async () => {}, record = () => {}, tracker = createNukeTracker(), onTriggered = () => {} }) {
  const handled = new Set();
  async function onAction(guild, action, item, targetId) {
    const config = getAntiNukeConfig(guild.id);
    if (!config.enabled) return;
    const executor = await findExecutor(guild, NUKE_ACTIONS[action].audit, targetId);
    if (!executor?.id) return;
    if (isExempt(executor.id, { guildOwnerId: guild.ownerId, ownerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID), trusted: config.trusted, botIds: fwuBotIds(), selfId: client.user?.id })) return;
    const { triggered, recent } = tracker.hit(guild.id, executor.id, item, config);
    if (!triggered) return;
    const key = `${guild.id}:${executor.id}`;
    const already = handled.has(key);
    handled.add(key);
    setTimeout(() => handled.delete(key), config.windowSeconds * 1000).unref?.();
    const outcome = already ? "déjà neutralisé" : await neutralize(guild, executor.id).catch(() => "neutralisation impossible");
    const restored = await restore(guild, already ? [item] : recent.filter(Boolean), "Anti-nuke FWU : restauration");
    tracker.clear(guild.id, executor.id);
    record("antinuke_triggered");
    try { await onTriggered(guild, { executorId: executor.id, action: NUKE_ACTIONS[action].label, outcome, restored }); } catch { /* l'incident ne bloque jamais la défense */ }
    await report(guild, {
      title: "🚨 Anti-nuke — attaque bloquée",
      description: `Auteur : <@${executor.id}> (\`${executor.id}\`)\nAction : **${NUKE_ACTIONS[action].label}** (${config.threshold}+ en ${config.windowSeconds} s)\nMesure : **${outcome}**\nÉléments restaurés : **${restored}**\nVérifie le journal d'audit du serveur.`,
      color: 0xdc2626,
    }).catch(() => {});
  }
  return {
    channelDelete: (channel) => channel.guild && onAction(channel.guild, "channelDelete", channelSnapshot(channel), channel.id),
    roleDelete: (role) => onAction(role.guild, "roleDelete", roleSnapshot(role), role.id),
    ban: (ban) => onAction(ban.guild, "ban", { kind: "ban", userId: ban.user.id }, ban.user.id),
    memberRemove: (member) => onAction(member.guild, "kick", null, member.id),
    webhooksUpdate: (channel) => channel.guild && onAction(channel.guild, "webhookCreate", null, null),
  };
}
