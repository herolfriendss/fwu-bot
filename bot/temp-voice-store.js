// Vocal V2 — stockage SQLite des salons temporaires, des listes du
// propriétaire et de ses préférences. Toujours filtré par serveur.
import { db } from "./database.js";
import { clampVoiceLimit, tempVoiceNameIsValid } from "./voice-v2-policy.js";

export function getTempVoice(channelId) {
  return db.prepare("SELECT * FROM temp_voice WHERE channel_id=?").get(channelId) ?? null;
}

export function latestTempVoiceOf(guildId, ownerId) {
  return db.prepare("SELECT * FROM temp_voice WHERE guild_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 1").get(guildId, ownerId) ?? null;
}

export function insertTempVoice({ channelId, guildId, ownerId, now = Date.now() }) {
  db.prepare("INSERT INTO temp_voice(channel_id,guild_id,owner_id,created_at) VALUES(?,?,?,?)").run(channelId, guildId, ownerId, now);
}

export function setTempVoiceOwner(channelId, ownerId) {
  db.prepare("UPDATE temp_voice SET owner_id=? WHERE channel_id=?").run(ownerId, channelId);
}

export function deleteTempVoice(channelId) {
  db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(channelId);
}

export function deleteGuildTempVoices(guildId) {
  db.prepare("DELETE FROM temp_voice WHERE guild_id=?").run(guildId);
}

export function allTempVoices() {
  return db.prepare("SELECT * FROM temp_voice").all();
}

// ── Listes : confiance (peut toujours entrer) et bloqués (ne peut pas entrer).
export function listEntries(guildId, ownerId) {
  return db.prepare("SELECT target_id AS targetId, kind, created_at AS createdAt FROM temp_voice_lists WHERE guild_id=? AND owner_id=? ORDER BY created_at")
    .all(guildId, ownerId);
}

export function listEntry(guildId, ownerId, targetId) {
  return db.prepare("SELECT target_id AS targetId, kind FROM temp_voice_lists WHERE guild_id=? AND owner_id=? AND target_id=?")
    .get(guildId, ownerId, targetId) ?? null;
}

export function listSize(guildId, ownerId, kind) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM temp_voice_lists WHERE guild_id=? AND owner_id=? AND kind=?").get(guildId, ownerId, kind)?.n ?? 0);
}

/** Un membre n'est que dans une seule liste : l'ajout remplace l'autre. */
export function putListEntry({ guildId, ownerId, targetId, kind, now = Date.now() }) {
  db.prepare(`INSERT INTO temp_voice_lists(guild_id,owner_id,target_id,kind,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,owner_id,target_id) DO UPDATE SET kind=excluded.kind, created_at=excluded.created_at`)
    .run(guildId, ownerId, targetId, kind, now);
}

export function removeListEntry(guildId, ownerId, targetId) {
  return db.prepare("DELETE FROM temp_voice_lists WHERE guild_id=? AND owner_id=? AND target_id=?").run(guildId, ownerId, targetId).changes > 0;
}

// ── Préférences : nom et limite repris au prochain salon.
export function getPrefs(guildId, ownerId) {
  const row = db.prepare("SELECT name, user_limit FROM temp_voice_prefs WHERE guild_id=? AND owner_id=?").get(guildId, ownerId);
  if (!row) return null;
  return {
    name: tempVoiceNameIsValid(row.name) ? String(row.name).trim() : null,
    limit: row.user_limit === null || row.user_limit === undefined ? null : clampVoiceLimit(row.user_limit),
  };
}

export function savePrefs({ guildId, ownerId, name, limit, now = Date.now() }) {
  const current = db.prepare("SELECT name, user_limit FROM temp_voice_prefs WHERE guild_id=? AND owner_id=?").get(guildId, ownerId) ?? {};
  const nextName = name === undefined ? current.name ?? null : name;
  const nextLimit = limit === undefined ? current.user_limit ?? null : limit;
  db.prepare(`INSERT INTO temp_voice_prefs(guild_id,owner_id,name,user_limit,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,owner_id) DO UPDATE SET name=excluded.name, user_limit=excluded.user_limit, updated_at=excluded.updated_at`)
    .run(guildId, ownerId, nextName, nextLimit, now);
}

export function clearPrefs(guildId, ownerId) {
  db.prepare("DELETE FROM temp_voice_prefs WHERE guild_id=? AND owner_id=?").run(guildId, ownerId);
}
