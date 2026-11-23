import { createHash, randomUUID } from "node:crypto";
import { db, transaction } from "./database.js";

const SNOWFLAKE = /^\d{5,25}$/;
const MAX_SNAPSHOTS_PER_GUILD = 20;
const MAX_SNAPSHOT_BYTES = 500_000;

function values(collection) { return [...(collection?.values?.() ?? [])]; }
function bitfield(value) { return value?.bitfield != null ? BigInt(value.bitfield).toString() : String(value ?? "0"); }

export function buildGuildBlueprintSnapshot(guild, now = Date.now()) {
  if (!guild || !SNOWFLAKE.test(guild.id ?? "")) throw new Error("Serveur invalide.");
  const roles = values(guild.roles?.cache).filter((role) => !role.managed).map((role) => ({
    id: role.id, name: role.name, color: role.color, hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable), permissions: bitfield(role.permissions),
    position: Number(role.position ?? 0), managed: Boolean(role.managed),
  })).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const channels = values(guild.channels?.cache).filter((channel) => !channel.isThread?.()).map((channel) => ({
    id: channel.id, name: channel.name, type: Number(channel.type), parentId: channel.parentId ?? null,
    position: Number(channel.position ?? 0), topic: channel.topic ?? null,
    nsfw: Boolean(channel.nsfw), rateLimitPerUser: Number(channel.rateLimitPerUser ?? 0),
    bitrate: Number(channel.bitrate ?? 0), userLimit: Number(channel.userLimit ?? 0),
    permissionOverwrites: values(channel.permissionOverwrites?.cache).filter((overwrite) => Number(overwrite.type) === 0).map((overwrite) => ({
      id: overwrite.id, type: Number(overwrite.type), allow: bitfield(overwrite.allow), deny: bitfield(overwrite.deny),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const snapshot = { schemaVersion: 1, guildId: guild.id, guildName: String(guild.name ?? "Serveur").slice(0, 100), capturedAt: now, roles, channels };
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("La sauvegarde dépasse la limite de 500 Ko.");
  return snapshot;
}

export function createGuildBlueprint(guild, name, actorId, { authorizeActor, now = Date.now() } = {}) {
  if (!SNOWFLAKE.test(actorId ?? "")) throw new Error("Acteur invalide.");
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId: guild?.id, actorId, action: "sysplus.blueprint.create" }) !== true) throw new Error("Création de blueprint réservée à SYS+.");
  const safeName = String(name ?? "").trim().replace(/@/g, "＠").slice(0, 80);
  if (safeName.length < 2) throw new Error("Le nom doit contenir au moins 2 caractères.");
  const snapshot = buildGuildBlueprintSnapshot(guild, now);
  const json = JSON.stringify(snapshot);
  const blueprintId = randomUUID();
  const checksum = createHash("sha256").update(json).digest("hex");
  transaction(() => {
    db.prepare("INSERT INTO guild_blueprints(blueprint_id,guild_id,name,snapshot_json,checksum,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(blueprintId, guild.id, safeName, json, checksum, actorId, now);
    db.prepare(`DELETE FROM guild_blueprints WHERE guild_id=? AND blueprint_id NOT IN (\n      SELECT blueprint_id FROM guild_blueprints WHERE guild_id=? ORDER BY created_at DESC LIMIT ?\n    )`).run(guild.id, guild.id, MAX_SNAPSHOTS_PER_GUILD);
  });
  return { blueprintId, name: safeName, checksum, createdAt: now, roleCount: snapshot.roles.length, channelCount: snapshot.channels.length };
}

export function getGuildBlueprintSnapshot(guildId, blueprintId) {
  if (!SNOWFLAKE.test(guildId ?? "") || typeof blueprintId !== "string") throw new Error("Serveur ou blueprint invalide.");
  const row = db.prepare("SELECT name,snapshot_json,checksum,created_at FROM guild_blueprints WHERE guild_id=? AND blueprint_id=?").get(guildId, blueprintId);
  if (!row) throw new Error("Blueprint introuvable sur ce serveur.");
  const snapshot = JSON.parse(row.snapshot_json);
  const checksum = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  if (checksum !== row.checksum) throw new Error("Intégrité du blueprint invalide : export refusé.");
  return { name: row.name, snapshot, checksum: row.checksum, createdAt: Number(row.created_at) };
}

export function listGuildBlueprints(guildId, limit = MAX_SNAPSHOTS_PER_GUILD) {
  if (!SNOWFLAKE.test(guildId ?? "")) throw new Error("Serveur invalide.");
  const bounded = Math.max(1, Math.min(MAX_SNAPSHOTS_PER_GUILD, Number(limit) || MAX_SNAPSHOTS_PER_GUILD));
  return db.prepare("SELECT blueprint_id,name,checksum,created_by,created_at FROM guild_blueprints WHERE guild_id=? ORDER BY created_at DESC LIMIT ?")
    .all(guildId, bounded).map((row) => ({ blueprintId: row.blueprint_id, name: row.name, checksum: row.checksum, createdBy: row.created_by, createdAt: Number(row.created_at) }));
}

export function compareGuildBlueprint(guild, blueprintId, now = Date.now()) {
  if (!SNOWFLAKE.test(guild?.id ?? "") || typeof blueprintId !== "string") throw new Error("Serveur ou blueprint invalide.");
  const row = db.prepare("SELECT snapshot_json,checksum FROM guild_blueprints WHERE guild_id=? AND blueprint_id=?").get(guild.id, blueprintId);
  if (!row) throw new Error("Blueprint introuvable sur ce serveur.");
  const saved = JSON.parse(row.snapshot_json);
  const actualChecksum = createHash("sha256").update(JSON.stringify(saved)).digest("hex");
  if (actualChecksum !== row.checksum) throw new Error("Intégrité du blueprint invalide : comparaison refusée.");
  const current = buildGuildBlueprintSnapshot(guild, now);
  return {
    blueprintId, checksum: row.checksum, capturedAt: Number(saved.capturedAt), comparedAt: now,
    roles: diffCollection(saved.roles, current.roles), channels: diffCollection(saved.channels, current.channels),
  };
}

function diffCollection(before, after) {
  const oldMap = new Map(before.map((item) => [item.id, item]));
  const newMap = new Map(after.map((item) => [item.id, item]));
  const added = after.filter((item) => !oldMap.has(item.id)).map((item) => ({ id: item.id, name: item.name }));
  const removed = before.filter((item) => !newMap.has(item.id)).map((item) => ({ id: item.id, name: item.name }));
  const modified = after.filter((item) => oldMap.has(item.id) && JSON.stringify(oldMap.get(item.id)) !== JSON.stringify(item)).map((item) => ({ id: item.id, before: oldMap.get(item.id).name, after: item.name }));
  return { added, removed, modified, unchanged: Math.max(0, after.length - added.length - modified.length) };
}
