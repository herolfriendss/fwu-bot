// GUARD — three defences the bot did not have: a trap channel that catches
// self-bots, a full snapshot of the server's structure that can be restored
// after a nuke, and a lockdown that closes every channel at once.
//
// Restoring never deletes anything. It re-creates what is missing and repairs
// permissions, so running it on a healthy server is a no-op rather than a
// disaster.
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { filterGrantableRoleIds } from "../role-grant-guard.js";
import { db, transaction } from "../database.js";
import { publishEventSafe } from "../event-bus.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS guard_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, label TEXT,
    payload_json TEXT NOT NULL, roles INTEGER NOT NULL, channels INTEGER NOT NULL,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS guard_snapshots_guild ON guard_snapshots(guild_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS guard_honeypot (
    guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'quarantaine',
    enabled INTEGER NOT NULL DEFAULT 1, caught INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guard_lockdown (
    guild_id TEXT PRIMARY KEY, channels_json TEXT NOT NULL, reason TEXT,
    started_by TEXT NOT NULL, started_at INTEGER NOT NULL
  );
`);

export const MAX_SNAPSHOTS = 5;
export const HONEYPOT_ACTIONS = Object.freeze(["signaler", "quarantaine", "expulser", "bannir"]);

// ------------------------------------------------------------- honeypot ----

export const honeypotConfig = (guildId) => {
  const row = db.prepare("SELECT * FROM guard_honeypot WHERE guild_id=?").get(guildId);
  return row
    ? { channelId: row.channel_id, action: row.action, enabled: Boolean(row.enabled), caught: Number(row.caught) }
    : null;
};

export const saveHoneypot = (guildId, channelId, action, now = Date.now()) => {
  if (!HONEYPOT_ACTIONS.includes(action)) throw new Error("Action de piège inconnue.");
  db.prepare(`INSERT INTO guard_honeypot(guild_id,channel_id,action,enabled,created_at) VALUES(?,?,?,1,?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, action=excluded.action, enabled=1`)
    .run(guildId, channelId, action, now);
  return honeypotConfig(guildId);
};

export const disableHoneypot = (guildId) =>
  Number(db.prepare("UPDATE guard_honeypot SET enabled=0 WHERE guild_id=?").run(guildId).changes);

const countCatch = (guildId) => db.prepare("UPDATE guard_honeypot SET caught=caught+1 WHERE guild_id=?").run(guildId);

/**
 * Pure: should this message spring the trap? Staff and bots are never caught —
 * a moderator checking the channel must not ban themselves.
 */
export function honeypotVerdict({ config, channelId, isBot, isStaff, isOwner }) {
  if (!config?.enabled || config.channelId !== channelId) return { trapped: false };
  if (isBot || isStaff || isOwner) return { trapped: false, reason: "membre de confiance" };
  return { trapped: true, action: config.action };
}

/** Applies the trap. Returns what was done, or null when nothing applies. */
export async function springHoneypot(message, { isStaff = false, isOwner = false, quarantineRoleId = null } = {}) {
  const guild = message.guild;
  if (!guild) return null;
  const config = honeypotConfig(guild.id);
  const verdict = honeypotVerdict({
    config, channelId: message.channelId,
    isBot: Boolean(message.author?.bot), isStaff, isOwner,
  });
  if (!verdict.trapped) return null;

  countCatch(guild.id);
  await message.delete().catch(() => {});
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  const reason = "GUARD : message dans le salon piège";
  let applied = "signalé";

  if (member && verdict.action === "quarantaine" && quarantineRoleId) {
    // N'importe qui peut écrire dans le piège : le rôle de quarantaine ne doit rien donner.
    const grantable = (await filterGrantableRoleIds(guild, [quarantineRoleId])).length > 0;
    const ok = grantable && await member.roles.add(quarantineRoleId, reason).then(() => true).catch(() => false);
    applied = ok ? "mis en quarantaine" : "signalé (quarantaine impossible)";
  } else if (member && verdict.action === "expulser" && member.kickable) {
    applied = await member.kick(reason).then(() => "expulsé").catch(() => "signalé (expulsion impossible)");
  } else if (verdict.action === "bannir") {
    applied = await guild.members.ban(message.author.id, { reason, deleteMessageSeconds: 3600 })
      .then(() => "banni").catch(() => "signalé (bannissement impossible)");
  }

  publishEventSafe({
    guildId: guild.id, kind: "member.quarantined", subjectId: message.author.id, source: "guard",
    payload: { honeypot: true, applied },
  });
  return { applied, userId: message.author.id, action: verdict.action };
}

// ------------------------------------------------------------- snapshots ----

const overwriteSnapshot = (channel) =>
  [...(channel.permissionOverwrites?.cache?.values() ?? [])].map((overwrite) => ({
    id: overwrite.id, type: overwrite.type,
    allow: String(overwrite.allow?.bitfield ?? 0n), deny: String(overwrite.deny?.bitfield ?? 0n),
  }));

/** Reads the structure of a guild into a plain object that survives a restart. */
export function captureGuild(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((role) => !role.managed && role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id, name: role.name, color: role.color, hoist: role.hoist,
      mentionable: role.mentionable, position: role.position, permissions: String(role.permissions?.bitfield ?? 0n),
    }));
  const channels = [...guild.channels.cache.values()]
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map((channel) => ({
      id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId ?? null,
      position: channel.rawPosition ?? 0, topic: channel.topic ?? null,
      nsfw: Boolean(channel.nsfw), overwrites: overwriteSnapshot(channel),
    }));
  return { takenAt: Date.now(), guildId: guild.id, name: guild.name, roles, channels };
}

export function saveSnapshot({ guildId, label, payload, createdBy, now = Date.now() }) {
  const json = JSON.stringify(payload);
  if (json.length > 4_000_000) throw new Error("Serveur trop grand pour être sauvegardé en une fois.");
  return transaction(() => {
    const info = db.prepare(`INSERT INTO guard_snapshots(guild_id,label,payload_json,roles,channels,created_by,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(guildId, label ?? null, json, payload.roles.length, payload.channels.length, createdBy, now);
    // Keep only the most recent ones so one guild cannot fill the disk.
    db.prepare(`DELETE FROM guard_snapshots WHERE guild_id=? AND id NOT IN
      (SELECT id FROM guard_snapshots WHERE guild_id=? ORDER BY created_at DESC LIMIT ?)`)
      .run(guildId, guildId, MAX_SNAPSHOTS);
    return Number(info.lastInsertRowid);
  });
}

export const listSnapshots = (guildId) =>
  db.prepare("SELECT id,label,roles,channels,created_by,created_at FROM guard_snapshots WHERE guild_id=? ORDER BY created_at DESC")
    .all(guildId)
    .map((row) => ({ id: Number(row.id), label: row.label, roles: Number(row.roles), channels: Number(row.channels), createdBy: row.created_by, createdAt: Number(row.created_at) }));

export function loadSnapshot(guildId, id) {
  const row = db.prepare("SELECT * FROM guard_snapshots WHERE guild_id=? AND id=?").get(guildId, id);
  return row ? { id: Number(row.id), label: row.label, payload: JSON.parse(row.payload_json), createdAt: Number(row.created_at) } : null;
}

/**
 * Pure: what the snapshot has that the guild no longer does. Restoring only
 * ever adds, so anything created since the snapshot is reported but untouched.
 */
export function planRestore(snapshot, current) {
  const roleIds = new Set(current.roles.map((role) => role.id));
  const roleNames = new Set(current.roles.map((role) => role.name));
  const channelIds = new Set(current.channels.map((channel) => channel.id));
  const channelNames = new Set(current.channels.map((channel) => `${channel.type}:${channel.name}`));

  const missingRoles = snapshot.roles.filter((role) => !roleIds.has(role.id) && !roleNames.has(role.name));
  const missingChannels = snapshot.channels.filter((channel) => !channelIds.has(channel.id) && !channelNames.has(`${channel.type}:${channel.name}`));
  const added = current.channels.filter((channel) => !snapshot.channels.some((old) => old.id === channel.id)).length;
  return {
    missingRoles, missingChannels, addedSinceSnapshot: added,
    empty: !missingRoles.length && !missingChannels.length,
  };
}

/** Re-creates what the plan says is missing. Categories first, so children can be placed. */
export async function applyRestore(guild, plan, { reason = "GUARD : restauration", onStep = () => {} } = {}) {
  const created = { roles: 0, channels: 0 };
  const failed = [];
  const roleMap = new Map();

  for (const role of [...plan.missingRoles].reverse()) {
    const made = await guild.roles.create({
      name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable,
      permissions: BigInt(role.permissions), reason,
    }).catch(() => null);
    if (made) {
      roleMap.set(role.id, made.id);
      created.roles += 1;
      onStep(`rôle ${role.name}`);
    } else failed.push(`rôle ${role.name}`);
  }

  const categories = plan.missingChannels.filter((channel) => channel.type === ChannelType.GuildCategory);
  const others = plan.missingChannels.filter((channel) => channel.type !== ChannelType.GuildCategory);
  const parentMap = new Map();

  for (const channel of [...categories, ...others]) {
    const parent = channel.parentId
      ? parentMap.get(channel.parentId) ?? (guild.channels.cache.has(channel.parentId) ? channel.parentId : null)
      : null;
    const made = await guild.channels.create({
      name: channel.name, type: channel.type, parent, topic: channel.topic ?? undefined, nsfw: channel.nsfw,
      reason,
    }).catch(() => null);
    if (!made) {
      failed.push(`salon ${channel.name}`);
      continue;
    }
    if (channel.type === ChannelType.GuildCategory) parentMap.set(channel.id, made.id);
    created.channels += 1;
    onStep(`salon ${channel.name}`);
  }
  return { created, failed };
}

// -------------------------------------------------------------- lockdown ----

export const lockdownState = (guildId) => {
  const row = db.prepare("SELECT * FROM guard_lockdown WHERE guild_id=?").get(guildId);
  return row ? { channels: JSON.parse(row.channels_json), reason: row.reason, startedBy: row.started_by, startedAt: Number(row.started_at) } : null;
};

/**
 * Closes every text channel to @everyone and remembers which ones were already
 * closed, so lifting the lockdown restores the server as it was, not as a
 * blanket "everything open".
 */
export async function startLockdown(guild, { reason = "GUARD : verrouillage", startedBy, onStep = () => {} }) {
  if (lockdownState(guild.id)) throw new Error("Le serveur est déjà verrouillé.");
  const locked = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) continue;
    if (channel.parentId && channel.permissionsLocked) continue;
    const before = channel.permissionOverwrites?.cache?.get(guild.id)?.deny?.has?.(P.SendMessages) ?? false;
    if (before) continue;
    const ok = await channel.permissionOverwrites.edit(guild.id, { SendMessages: false }, { reason })
      .then(() => true).catch(() => false);
    if (ok) {
      locked.push(channel.id);
      onStep(channel.name);
    }
  }
  db.prepare("INSERT OR REPLACE INTO guard_lockdown(guild_id,channels_json,reason,started_by,started_at) VALUES(?,?,?,?,?)")
    .run(guild.id, JSON.stringify(locked), reason, startedBy, Date.now());
  return locked.length;
}

export async function liftLockdown(guild, { reason = "GUARD : déverrouillage" } = {}) {
  const state = lockdownState(guild.id);
  if (!state) throw new Error("Le serveur n'est pas verrouillé.");
  let restored = 0;
  for (const channelId of state.channels) {
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.permissionOverwrites) continue;
    const ok = await channel.permissionOverwrites.edit(guild.id, { SendMessages: null }, { reason })
      .then(() => true).catch(() => false);
    if (ok) restored += 1;
  }
  db.prepare("DELETE FROM guard_lockdown WHERE guild_id=?").run(guild.id);
  return restored;
}
