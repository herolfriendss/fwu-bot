// Her? V4 — audit local des actions SYS+ et staff.
//
// Les entrées ne contiennent jamais de secret : identifiants, action et
// métadonnées bornées. Les lectures sont toujours filtrées par serveur.
import { db } from "../../database.js";

const MAX_DETAILS = 2_000;

export function recordSysPlusAudit(guildId, actorId, action, targetId = null, details = null) {
  const payload = details == null ? null : JSON.stringify(details).slice(0, MAX_DETAILS);
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
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: Number(row.created_at),
  }));
}
