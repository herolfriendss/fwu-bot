// Her? V4 — audit local des actions SYS+ et staff.
//
// Les entrées ne contiennent jamais de secret : identifiants, action et
// métadonnées bornées. Les lectures sont toujours filtrées par serveur.
import { db } from "../../database.js";

const MAX_DETAILS = 2_000;

function serializeDetails(details) {
  if (details == null) return null;
  let payload;
  try {
    payload = JSON.stringify(details);
  } catch {
    return JSON.stringify({ truncated: true, reason: "unserializable" });
  }
  if (typeof payload !== "string") return JSON.stringify({ truncated: true, reason: "unsupported" });
  return payload.length <= MAX_DETAILS ? payload : JSON.stringify({ truncated: true, reason: "size_limit" });
}

function parseDetails(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function recordSysPlusAudit(guildId, actorId, action, targetId = null, details = null) {
  if (typeof guildId !== "string" || !guildId || typeof actorId !== "string" || !actorId) {
    throw new Error("Contexte serveur ou acteur SYS+ invalide.");
  }
  const payload = serializeDetails(details);
  db.prepare("INSERT INTO sysplus_audit(guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)")
    .run(guildId, actorId, String(action).slice(0, 100), targetId, payload, Date.now());
}

export function listSysPlusAudit(guildId, limit = 10) {
  const rows = db.prepare("SELECT * FROM sysplus_audit WHERE guild_id=? ORDER BY id DESC LIMIT ?").all(guildId, Math.min(50, Math.max(1, Number(limit) || 10)));
  return rows.map((row) => ({
    id: Number(row.id),
    actorId: row.actor_id,
    action: row.action,
    targetId: row.target_id,
    details: parseDetails(row.details),
    createdAt: Number(row.created_at),
  }));
}

export function listPndAdjustmentAudit(guildId, limit = 20) {
  const rows = db.prepare("SELECT * FROM sysplus_audit WHERE guild_id=? AND action LIKE 'pnd.%' ORDER BY id DESC LIMIT ?")
    .all(guildId, Math.min(50, Math.max(1, Number(limit) || 20)));
  return rows.map((row) => ({
    id: Number(row.id),
    actorId: row.actor_id,
    action: row.action,
    targetId: row.target_id,
    details: parseDetails(row.details),
    createdAt: Number(row.created_at),
  }));
}
