// FWU — gel d'urgence du staff (idée SYS+ n°1 de l'Éclaireur).
//
// L'owner coupe d'un coup toutes les commandes de modération à quota du staff, sur les
// 5 bots (lu par consumeQuota), pour une durée choisie. L'owner (palier 0) et les exemptés
// ne sont jamais gelés. Option : retirer le rôle ADMIN+ à ceux qui l'ont ; il leur est
// rendu au dégel (attribution faite au nom de l'owner, via role-grant-guard).
import { sharedQuery, sharedTransaction } from "./db.js";

export const FREEZE_MAX_SECONDS = 7 * 24 * 3600;

function mapRow(row) {
  return row ? {
    until: new Date(row.until).getTime(),
    reason: row.reason ?? "",
    createdBy: row.created_by,
    removedAdminPlus: Array.isArray(row.removed_admin_plus) ? row.removed_admin_plus : [],
  } : null;
}

/** Gel en cours (null s'il n'y en a pas ou s'il a expiré). */
export async function getStaffFreeze(guildId, client = null) {
  const run = client ?? { query: sharedQuery };
  const { rows } = await run.query("SELECT * FROM staff_freeze WHERE guild_id = $1 AND until > now()", [guildId]);
  return mapRow(rows[0]);
}

export async function setStaffFreeze({ guildId, seconds, reason = "", actorId, bot, removedAdminPlus = [] }) {
  const secs = Math.round(Number(seconds));
  if (!Number.isFinite(secs) || secs < 60 || secs > FREEZE_MAX_SECONDS) throw new Error("Durée du gel : entre 1 min et 7 jours.");
  return sharedTransaction(async (client) => {
    const before = (await client.query("SELECT * FROM staff_freeze WHERE guild_id = $1 FOR UPDATE", [guildId])).rows[0] ?? null;
    // Un nouveau gel garde la liste des ADMIN+ déjà retirés par le précédent (pour pouvoir les rendre).
    const keep = before ? (before.removed_admin_plus ?? []) : [];
    const removed = [...new Set([...keep, ...removedAdminPlus])];
    const { rows } = await client.query(`INSERT INTO staff_freeze(guild_id, until, reason, created_by, removed_admin_plus)
      VALUES ($1, now() + make_interval(secs => $2), $3, $4, $5::jsonb)
      ON CONFLICT (guild_id) DO UPDATE SET until = excluded.until, reason = excluded.reason, created_by = excluded.created_by, created_at = now(), removed_admin_plus = excluded.removed_admin_plus
      RETURNING *`, [guildId, secs, String(reason).slice(0, 300), actorId, JSON.stringify(removed)]);
    await client.query(`INSERT INTO config_changes(guild_id, actor_id, bot, entity, entity_key, before, after) VALUES ($1, $2, $3, 'staff_freeze', 'gel', $4, $5)`,
      [guildId, actorId, bot, before ? JSON.stringify({ until: before.until }) : null, JSON.stringify({ seconds: secs, reason: String(reason).slice(0, 300), removedAdminPlus: removed.length })]);
    return mapRow(rows[0]);
  });
}

/** Dégel (manuel ou à l'expiration). Renvoie la ligne supprimée (pour rendre ADMIN+), ou null. */
export async function liftStaffFreeze({ guildId, actorId, bot, onlyExpired = false }) {
  return sharedTransaction(async (client) => {
    const { rows } = await client.query(`DELETE FROM staff_freeze WHERE guild_id = $1 ${onlyExpired ? "AND until <= now()" : ""} RETURNING *`, [guildId]);
    if (!rows[0]) return null;
    await client.query(`INSERT INTO config_changes(guild_id, actor_id, bot, entity, entity_key, before, after) VALUES ($1, $2, $3, 'staff_freeze', 'degel', $4, NULL)`,
      [guildId, actorId, bot, JSON.stringify({ until: rows[0].until, expired: onlyExpired })]);
    return mapRow(rows[0]);
  });
}

/** Serveurs dont le gel a expiré (à dégeler, et ADMIN+ à rendre). */
export async function expiredStaffFreezes() {
  const { rows } = await sharedQuery("SELECT guild_id FROM staff_freeze WHERE until <= now()");
  return rows.map((row) => row.guild_id);
}
