// FWU V2 — BLR (« blacklist rank ») : la punition ultime.
//
// Un membre BLR ne garde que le rôle membre et le rôle BLR (plus @everyone et les rôles
// gérés par une intégration, que personne ne peut retirer). Il ne peut recevoir aucun autre
// rôle, quel que soit le chemin :
//   • blr-shield.js refuse l'ajout au niveau discord.js (commandes, rankall, attributions
//     automatiques, restaurations…) ;
//   • enforceBlrMember remet l'état correct après une action extérieure (autre bot, action
//     manuelle dans Discord), au démarrage et au retour d'un membre parti.
// L'état est persistant en base (raison, auteur, date, durée éventuelle, rôles retirés).
// Poser / lever : OWNER, paliers 0 % et 1 % seulement.
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS blr_state (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    actor_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    saved_roles TEXT NOT NULL DEFAULT '[]',
    lifted_at INTEGER,
    lifted_by TEXT,
    case_number INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS blr_config (
    guild_id TEXT PRIMARY KEY,
    blr_role_id TEXT,
    member_role_id TEXT
  );
`);

export const BLR_REFUSAL = "⛔ Ce membre est BLR : il ne peut recevoir aucun rôle au-dessus du rôle membre.";

const internal = new AsyncLocalStorage();
/** Les opérations du module BLR lui-même passent le bouclier. */
export function runBlrInternal(fn) {
  return internal.run(true, fn);
}
export function isBlrInternal() {
  return internal.getStore() === true;
}

export function getBlrConfig(guildId) {
  const row = db.prepare("SELECT blr_role_id, member_role_id FROM blr_config WHERE guild_id = ?").get(String(guildId));
  return { blrRoleId: row?.blr_role_id ?? null, memberRoleId: row?.member_role_id ?? null };
}

export function setBlrConfig(guildId, { blrRoleId, memberRoleId }) {
  db.prepare(`INSERT INTO blr_config(guild_id, blr_role_id, member_role_id) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET blr_role_id = excluded.blr_role_id, member_role_id = excluded.member_role_id`)
    .run(String(guildId), blrRoleId ?? null, memberRoleId ?? null);
}

/** État BLR actif d'un membre (null sinon ; un BLR expiré compte comme inactif). */
export function getBlr(guildId, userId, now = Date.now()) {
  const row = db.prepare("SELECT * FROM blr_state WHERE guild_id = ? AND user_id = ? AND active = 1").get(String(guildId), String(userId));
  if (!row) return null;
  if (row.expires_at && row.expires_at <= now) return null;
  return {
    guildId: row.guild_id, userId: row.user_id, reason: row.reason, actorId: row.actor_id, createdAt: row.created_at,
    expiresAt: row.expires_at, savedRoles: JSON.parse(row.saved_roles || "[]"), caseNumber: row.case_number,
  };
}

export function isBlr(guildId, userId, now = Date.now()) {
  return Boolean(getBlr(guildId, userId, now));
}

export function listActiveBlr(guildId = null, now = Date.now()) {
  const rows = guildId
    ? db.prepare("SELECT guild_id, user_id FROM blr_state WHERE active = 1 AND guild_id = ?").all(String(guildId))
    : db.prepare("SELECT guild_id, user_id FROM blr_state WHERE active = 1").all();
  return rows.map((row) => getBlr(row.guild_id, row.user_id, now)).filter(Boolean);
}

export function listExpiredBlr(now = Date.now()) {
  return db.prepare("SELECT guild_id AS guildId, user_id AS userId FROM blr_state WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?").all(now);
}

export function recordBlr({ guildId, userId, reason = null, actorId = null, expiresAt = null, savedRoles = [], caseNumber = null }, now = Date.now()) {
  db.prepare(`INSERT INTO blr_state(guild_id, user_id, active, reason, actor_id, created_at, expires_at, saved_roles, case_number, lifted_at, lifted_by)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET active = 1, reason = excluded.reason, actor_id = excluded.actor_id,
      created_at = excluded.created_at, expires_at = excluded.expires_at, saved_roles = excluded.saved_roles,
      case_number = excluded.case_number, lifted_at = NULL, lifted_by = NULL`)
    .run(String(guildId), String(userId), reason, actorId, now, expiresAt, JSON.stringify(savedRoles), caseNumber);
}

export function markBlrLifted(guildId, userId, liftedBy = null, now = Date.now()) {
  db.prepare("UPDATE blr_state SET active = 0, lifted_at = ?, lifted_by = ? WHERE guild_id = ? AND user_id = ?").run(now, liftedBy, String(guildId), String(userId));
}

/**
 * Décision pure : un rôle peut-il être porté par un membre BLR ?
 * Autorisés : @everyone, rôle membre, rôle BLR, rôles gérés par une intégration.
 */
export function roleAllowedForBlr(role, { guildId, blrRoleId, memberRoleId }) {
  const id = typeof role === "string" ? role : role?.id;
  if (!id) return false;
  if (id === guildId || id === blrRoleId || id === memberRoleId) return true;
  return typeof role === "object" && role?.managed === true;
}

/** Rôles en trop chez un membre BLR (ids). */
export function excessBlrRoles(roles, config) {
  return roles.filter((role) => !roleAllowedForBlr(role, config)).map((role) => (typeof role === "string" ? role : role.id));
}

/** Filtre une liste de rôles à donner / restaurer à `userId` (restaurations : quarantaine…). */
export function filterRolesForBlr(guildId, userId, roleIds, now = Date.now()) {
  if (!isBlr(guildId, userId, now)) return [...roleIds];
  const config = { guildId, ...getBlrConfig(guildId) };
  return roleIds.filter((roleId) => roleAllowedForBlr(roleId, config));
}

/** Refus lisible pour donner `role` à `userId`, ou null. Utilisé par role-grant-guard. */
export function blrGrantRefusal(guildId, userId, role, now = Date.now()) {
  if (!guildId || !userId || !isBlr(guildId, userId, now)) return null;
  return roleAllowedForBlr(role, { guildId, ...getBlrConfig(guildId) }) ? null : BLR_REFUSAL;
}

/** Durée « 7j », « 12h » → millisecondes (null : définitif). */
export function parseBlrDuration(text) {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value || /^(def|définitif|definitif|perm|permanent)$/.test(value)) return null;
  const match = value.match(/^(\d{1,4})\s*(m|min|h|j|d)$/);
  if (!match) throw new Error("Durée illisible : 30m, 12h, 7j ou « définitif ».");
  const n = Number(match[1]);
  const unit = match[2];
  return n * (unit === "h" ? 3_600_000 : unit === "j" || unit === "d" ? 86_400_000 : 60_000);
}
