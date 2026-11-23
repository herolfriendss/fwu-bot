// Her? V5 — consentement mémoire IA, isolé par serveur et membre.
import { db } from "./database.js";

const getPreference = db.prepare(
  "SELECT enabled FROM ai_memory_consent WHERE guild_id=? AND user_id=?",
);
const savePreference = db.prepare(`
  INSERT INTO ai_memory_consent(guild_id,user_id,enabled,updated_at) VALUES(?,?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at
`);

export function hasAiMemoryConsent(guildId, userId) {
  if (!guildId || !userId) return false;
  return getPreference.get(String(guildId), String(userId))?.enabled === 1;
}

export function setAiMemoryConsent(guildId, userId, enabled) {
  if (!guildId || !userId) throw new TypeError("guildId et userId sont obligatoires");
  savePreference.run(String(guildId), String(userId), enabled ? 1 : 0, Date.now());
  return enabled === true;
}
