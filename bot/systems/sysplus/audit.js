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

// S1 : les actions qui changent des droits partent aussi au Logs Hub (RESUME les voit).
const SENSITIVE_PREFIXES = Object.freeze([
  "sysplus.role", "sysplus.member.", "adminplus.", "whitelist.role", "sysplus.member_role", "sysplus.custom_role",
  "permission.", "staff.supervisor", "entitlement.", "sysplus.clone.apply", "owner.", "dog.whitelist_quota_exception",
]);
let observer = null;

export function isSensitiveSysPlusAction(action) {
  const text = String(action ?? "");
  return SENSITIVE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** Branché au démarrage du bot : fn({ guildId, actorId, action, targetId, details }). Ne bloque jamais l'audit. */
export function setSysPlusAuditObserver(fn) {
  observer = typeof fn === "function" ? fn : null;
}

export function recordSysPlusAudit(guildId, actorId, action, targetId = null, details = null) {
  if (typeof guildId !== "string" || !guildId || typeof actorId !== "string" || !actorId) {
    throw new Error("Contexte serveur ou acteur SYS+ invalide.");
  }
  const payload = serializeDetails(details);
  db.prepare("INSERT INTO sysplus_audit(guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)")
    .run(guildId, actorId, String(action).slice(0, 100), targetId, payload, Date.now());
  if (observer && isSensitiveSysPlusAction(action)) {
    try { void Promise.resolve(observer({ guildId, actorId, action: String(action).slice(0, 100), targetId, details: parseDetails(payload) })).catch(() => {}); } catch { /* jamais bloquant */ }
  }
}

/** `filter.memberId` : auteur OU cible ; `filter.action` : début du nom d'action (ex. « whitelist »). */
export function listSysPlusAudit(guildId, limit = 10, filter = {}) {
  const where = ["guild_id=?"];
  const params = [guildId];
  if (filter.memberId) { where.push("(actor_id=? OR target_id=?)"); params.push(String(filter.memberId), String(filter.memberId)); }
  if (filter.action) { where.push("action LIKE ? ESCAPE '\\'"); params.push(`${String(filter.action).slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
  const rows = db.prepare(`SELECT * FROM sysplus_audit WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...params, Math.min(50, Math.max(1, Number(limit) || 10)));
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
