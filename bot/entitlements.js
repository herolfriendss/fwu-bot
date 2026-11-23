import { db } from "./database.js";
import { isConfiguredPndOwner } from "./pnd-owner-policy.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";

/**
 * Premium pack entitlements (V5 reference, PND_V5_FEATURES "Packs premium SYS+").
 *
 * Rules:
 *  - grants and revocations are manual and reserved to the single configured PND
 *    owner (PND_OWNER_DISCORD_ID), checked through the central owner policy;
 *  - each grant is scoped to one guild and one pack, and may expire;
 *  - PRIME, SYS+ and Discord roles are never linked automatically;
 *  - expiry is computed at read time, so no background job can silently extend
 *    or drop a grant; revocation is recorded, never deleted;
 *  - every grant and revocation is written to the guild audit.
 * Payments are out of scope and can later create grants through this same API.
 */

export const ENTITLEMENT_PACKS = Object.freeze([
  "ai.advanced", "automation.advanced", "analytics.advanced", "commands.exclusive",
  "creator.studio", "server.tools", "social.advanced", "economy.advanced",
  "games.premium", "studio.personal", "cloud", "marketplace", "extensions", "lab",
]);
export const MAX_ENTITLEMENT_DAYS = 730;
const DAY_MS = 86_400_000;

export function entitlementStatus(row, now = Date.now()) {
  if (row.revoked_at) return "revoked";
  if (row.expires_at != null && Number(row.expires_at) <= now) return "expired";
  return "active";
}

function toRecord(row, now) {
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    packKey: row.pack_key,
    grantedBy: row.granted_by,
    grantedAt: Number(row.granted_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    revokedBy: row.revoked_by ?? null,
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
    note: row.note ?? null,
    status: entitlementStatus(row, now),
  };
}

function requireOwner(actorId, configuredOwners, guildId) {
  if (!isConfiguredPndOwner(actorId, configuredOwners, guildId)) {
    throw new Error("Seuls le propriétaire PND configuré peuvent gérer les packs.");
  }
}

/**
 * Grants a pack for one guild. `durationDays` null means no expiry, otherwise
 * 1..MAX_ENTITLEMENT_DAYS. A second active grant for the same pack is refused:
 * revoke the existing one first, so history stays unambiguous.
 */
export function grantEntitlement({ guildId, packKey, actorId, durationDays = null, note = null, configuredOwners, now = Date.now() }) {
  requireOwner(actorId, configuredOwners, guildId);
  if (!ENTITLEMENT_PACKS.includes(packKey)) throw new Error("Pack inconnu.");
  if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_ENTITLEMENT_DAYS)) {
    throw new Error(`La durée doit être comprise entre 1 et ${MAX_ENTITLEMENT_DAYS} jours.`);
  }
  const safeNote = note ? String(note).replace(/@/g, "＠").slice(0, 200) : null;
  const active = db.prepare("SELECT * FROM guild_entitlements WHERE guild_id=? AND pack_key=? AND revoked_at IS NULL").all(guildId, packKey)
    .find((row) => entitlementStatus(row, now) === "active");
  if (active) throw new Error(`Le pack ${packKey} est déjà actif sur ce serveur (attribution #${active.id}). Révoque-la avant d'en créer une autre.`);

  const expiresAt = durationDays === null ? null : now + durationDays * DAY_MS;
  const result = db.prepare("INSERT INTO guild_entitlements(guild_id,pack_key,granted_by,granted_at,expires_at,note) VALUES(?,?,?,?,?,?)")
    .run(guildId, packKey, actorId, now, expiresAt, safeNote);
  const id = Number(result.lastInsertRowid);
  recordSysPlusAudit(guildId, actorId, "entitlement.grant", String(id), { pack: packKey, expiresAt, days: durationDays });
  return toRecord(db.prepare("SELECT * FROM guild_entitlements WHERE id=?").get(id), now);
}

export function revokeEntitlement({ guildId, entitlementId, actorId, configuredOwners, now = Date.now() }) {
  requireOwner(actorId, configuredOwners, guildId);
  const row = db.prepare("SELECT * FROM guild_entitlements WHERE id=? AND guild_id=?").get(Number(entitlementId), guildId);
  if (!row) throw new Error("Attribution introuvable sur ce serveur.");
  if (row.revoked_at) throw new Error("Cette attribution est déjà révoquée.");
  db.prepare("UPDATE guild_entitlements SET revoked_by=?, revoked_at=? WHERE id=? AND guild_id=?").run(actorId, now, row.id, guildId);
  recordSysPlusAudit(guildId, actorId, "entitlement.revoke", String(row.id), { pack: row.pack_key });
  return toRecord({ ...row, revoked_by: actorId, revoked_at: now }, now);
}

export function listEntitlements(guildId, now = Date.now(), limit = 50) {
  return db.prepare("SELECT * FROM guild_entitlements WHERE guild_id=? ORDER BY id DESC LIMIT ?")
    .all(guildId, Math.min(100, Math.max(1, Number(limit) || 50)))
    .map((row) => toRecord(row, now));
}

/** Pack keys currently active for a guild. Callers pass this into authorize(). */
export function activeEntitlementKeys(guildId, now = Date.now()) {
  if (!guildId) return [];
  const rows = db.prepare("SELECT * FROM guild_entitlements WHERE guild_id=? AND revoked_at IS NULL").all(guildId);
  return [...new Set(rows.filter((row) => entitlementStatus(row, now) === "active").map((row) => row.pack_key))];
}
