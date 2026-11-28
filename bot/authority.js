// AUTHORITY 3.1 — registre central des dérogations (service, sans bot Discord pour l'instant).
//
// Règles (docs/specs/CAHIER_DES_CHARGES_FWU_V2.md § 5) :
//  • seul l'OWNER configuré (PND_OWNER_DISCORD_ID) approuve, refuse, suspend, réactive, révoque,
//    prolonge ou modifie ; aucune délégation ; ni SYS+, ni ADMIN+, ni le propriétaire du serveur,
//    ni un bot ;
//  • personne n'approuve sa propre demande ; l'OWNER ne peut pas être bénéficiaire ;
//  • une dérogation ne vise QUE les actions « dérogeables » du catalogue de core-permissions.js :
//    jamais un rôle, une permission Discord, le Tier 0, une protection, une action OWNER ;
//  • temporaire : expiration stockée, vérifiée à chaque lecture (fiable après redémarrage) ;
//  • chaque décision OWNER porte un nonce à usage unique (un ancien bouton est refusé) ;
//  • chaque dérogation active est signée (HMAC, secret serveur PND_AUTHORITY_SECRET ou, à
//    défaut, BOT_SYNC_SECRET) : une ligne modifiée à la main dans la base ne vaut rien ;
//  • toute anomalie (signature, base indisponible, secret absent) = refus ;
//  • tout est tracé : authority_events + journal chaîné core_audit.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db as defaultDb } from "./database.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { ACTIONS } from "./core-permissions.js";
import { appendAuditSafe } from "./core-audit.js";

export const MIN_DURATION_MS = 60 * 60_000;
export const MAX_DURATION_MS = 30 * 86_400_000;
export const DEFAULT_DURATION_MS = 24 * 3_600_000;
export const MAX_PENDING_PER_REQUESTER = 3;
export const STATUS_LABELS = Object.freeze({ pending: "en attente", refused: "refusée", active: "active", suspended: "suspendue", expired: "expirée", revoked: "révoquée" });

/** Only the actions that core-permissions marks as exceptionable (never owner-level). */
export const EXCEPTIONABLE = Object.freeze(Object.entries(ACTIONS).filter(([, a]) => a.exception && a.level !== "owner").map(([name]) => name));

export function ensureAuthorityTables(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL, number INTEGER NOT NULL,
      requester_id TEXT NOT NULL, beneficiary_id TEXT NOT NULL,
      permission TEXT NOT NULL, service TEXT NOT NULL, justification TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      nonce TEXT NOT NULL, created_at INTEGER NOT NULL,
      decided_by TEXT, decided_at INTEGER, starts_at INTEGER, expires_at INTEGER,
      signature TEXT, reminded INTEGER NOT NULL DEFAULT 0,
      UNIQUE (guild_id, number)
    );
    CREATE INDEX IF NOT EXISTS authority_active ON authority_requests(guild_id, beneficiary_id, permission, status);
    CREATE TABLE IF NOT EXISTS authority_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, guild_id TEXT NOT NULL,
      kind TEXT NOT NULL, actor_id TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
    );
  `);
}

const secretOf = (env) => String(env.PND_AUTHORITY_SECRET || env.BOT_SYNC_SECRET || "");
function sign(row, secret) {
  return createHmac("sha256", secret).update(JSON.stringify(["authority-v1", row.uid, row.guild_id, row.beneficiary_id, row.permission, Number(row.starts_at), Number(row.expires_at)])).digest("hex");
}
function signatureValid(row, secret) {
  if (!secret || !row.signature) return false;
  const expected = Buffer.from(sign(row, secret), "hex");
  const given = Buffer.from(String(row.signature), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const clean = (value, max) => String(value ?? "").replace(/@(everyone|here)/gi, "@​$1").replace(/\s+/g, " ").trim().slice(0, max);

function log(db, row, kind, actorId, detail, now) {
  db.prepare("INSERT INTO authority_events(request_id, guild_id, kind, actor_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(row.id, row.guild_id, kind, actorId, detail ?? null, now);
  appendAuditSafe({ guildId: row.guild_id, source: "authority", actorId, action: `authority.${kind}`, target: `demande:${row.number}`, details: { beneficiary: row.beneficiary_id, permission: row.permission, detail: detail ?? null } }, { db, now });
}

/** Any member may ask, for themself or someone else, with a mandatory justification. */
export function createRequest({ guildId, requesterId, beneficiaryId, permission, service = "core", justification, durationMs = DEFAULT_DURATION_MS }, { db = defaultDb, env = process.env, now = Date.now() } = {}) {
  ensureAuthorityTables(db);
  const ownerId = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (!/^\d{5,25}$/.test(String(guildId))) return { error: "Serveur invalide." };
  if (!EXCEPTIONABLE.includes(permission)) return { error: "Cette autorisation ne peut pas faire l'objet d'une dérogation (rôles, permissions Discord, protections et actions OWNER sont exclus)." };
  if (!beneficiaryId || !requesterId) return { error: "Demandeur ou bénéficiaire manquant." };
  if (ownerId && beneficiaryId === ownerId) return { error: "L'OWNER ne peut pas recevoir de dérogation." };
  const why = clean(justification, 500);
  if (why.length < 10) return { error: "La justification est obligatoire (au moins 10 caractères)." };
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) return { error: "Durée : entre 1 heure et 30 jours." };
  const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM authority_requests WHERE guild_id = ? AND requester_id = ? AND status = 'pending'").get(String(guildId), requesterId).n);
  if (pending >= MAX_PENDING_PER_REQUESTER) return { error: `Tu as déjà ${pending} demandes en attente.` };
  if (db.prepare("SELECT 1 FROM authority_requests WHERE guild_id = ? AND beneficiary_id = ? AND permission = ? AND status IN ('pending', 'active', 'suspended')").get(String(guildId), beneficiaryId, permission)) {
    return { error: "Une demande ou une dérogation existe déjà pour ce membre et cette autorisation." };
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const number = Number(db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM authority_requests WHERE guild_id = ?").get(String(guildId)).n);
    const uid = randomUUID();
    const info = db.prepare(`INSERT INTO authority_requests(uid, guild_id, number, requester_id, beneficiary_id, permission, service, justification, duration_ms, nonce, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, String(guildId), number, requesterId, beneficiaryId, permission, clean(service, 30), why, Math.round(duration), randomUUID(), now);
    const row = db.prepare("SELECT * FROM authority_requests WHERE id = ?").get(info.lastInsertRowid);
    log(db, row, "request", requesterId, why, now);
    db.exec("COMMIT");
    return { number, uid, nonce: row.nonce };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getRequest(guildId, number, { db = defaultDb } = {}) {
  ensureAuthorityTables(db);
  return db.prepare("SELECT * FROM authority_requests WHERE guild_id = ? AND number = ?").get(String(guildId), Number(number)) ?? null;
}

/** Status as seen now: an active row past its end is expired, even before the job marks it. */
export function effectiveStatus(row, now = Date.now()) {
  if (row.status === "active" && Number(row.expires_at) <= now) return "expired";
  return row.status;
}

/**
 * OWNER decisions. action: approve | refuse | suspend | resume | revoke | extend.
 * nonce: required for approve/refuse (single use, rotated after each decision).
 */
export function decideRequest({ guildId, number, actorId, action, nonce = null, durationMs = null }, { db = defaultDb, env = process.env, now = Date.now() } = {}) {
  ensureAuthorityTables(db);
  const ownerId = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (!ownerId || actorId !== ownerId) return { error: "Seul l'OWNER décide des dérogations." };
  let row = getRequest(guildId, number, { db });
  if (!row) return { error: `Demande n°${number} introuvable sur ce serveur.` };
  const secret = secretOf(env);
  const rotate = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Re-read only after acquiring the write lock. A second OWNER interaction may have
    // loaded the same pending row before the first decision committed.
    row = getRequest(guildId, number, { db });
    if (!row) throw new Error(`Demande n°${number} introuvable sur ce serveur.`);
    if (row.requester_id === actorId && (action === "approve" || action === "extend")) throw new Error("Personne ne peut approuver sa propre demande.");
    if (row.beneficiary_id === ownerId) throw new Error("L'OWNER ne peut pas être bénéficiaire.");
    const status = effectiveStatus(row, now);
    const update = (sql, ...params) => {
      const result = db.prepare(sql).run(...params);
      if (result.changes !== 1) throw new Error("Cette demande a déjà été modifiée : recharge son état avant de réessayer.");
      return result;
    };
    let result;
    if (action === "approve" || action === "refuse") {
      if (row.status !== "pending") throw new Error(`Demande déjà traitée (${STATUS_LABELS[status] ?? status}).`);
      if (!nonce || nonce !== row.nonce) throw new Error("Décision expirée ou déjà utilisée : rouvre la demande.");
      if (action === "approve") {
        if (!secret) throw new Error("Secret serveur absent (PND_AUTHORITY_SECRET) : aucune dérogation ne peut être accordée.");
        const signed = { ...row, starts_at: now, expires_at: now + Number(row.duration_ms) };
        update("UPDATE authority_requests SET status = 'active', decided_by = ?, decided_at = ?, starts_at = ?, expires_at = ?, signature = ?, nonce = ? WHERE id = ? AND status = 'pending' AND nonce = ?",
          actorId, now, signed.starts_at, signed.expires_at, sign(signed, secret), rotate, row.id, nonce);
        result = { status: "active", expiresAt: signed.expires_at };
      } else {
        update("UPDATE authority_requests SET status = 'refused', decided_by = ?, decided_at = ?, nonce = ? WHERE id = ? AND status = 'pending' AND nonce = ?",
          actorId, now, rotate, row.id, nonce);
        result = { status: "refused" };
      }
    } else if (action === "suspend") {
      if (status !== "active") throw new Error("Seule une dérogation active peut être suspendue.");
      update("UPDATE authority_requests SET status = 'suspended', nonce = ? WHERE id = ? AND status = 'active'", rotate, row.id);
      result = { status: "suspended" };
    } else if (action === "resume") {
      if (row.status !== "suspended") throw new Error("Cette dérogation n'est pas suspendue.");
      if (Number(row.expires_at) <= now) throw new Error("Cette dérogation a expiré pendant la suspension.");
      if (!signatureValid(row, secret)) throw new Error("Signature invalide : dérogation non réactivable.");
      update("UPDATE authority_requests SET status = 'active', nonce = ? WHERE id = ? AND status = 'suspended'", rotate, row.id);
      result = { status: "active" };
    } else if (action === "revoke") {
      if (!["active", "suspended", "pending"].includes(status)) throw new Error(`Rien à révoquer (${STATUS_LABELS[status] ?? status}).`);
      update("UPDATE authority_requests SET status = 'revoked', signature = NULL, nonce = ? WHERE id = ? AND status IN ('active', 'suspended', 'pending')", rotate, row.id);
      result = { status: "revoked" };
    } else if (action === "extend") {
      const extra = Number(durationMs);
      if (status !== "active") throw new Error("Seule une dérogation active peut être prolongée.");
      if (!Number.isFinite(extra) || extra < MIN_DURATION_MS) throw new Error("Prolongation d'au moins 1 heure.");
      if (!secret) throw new Error("Secret serveur absent : prolongation impossible.");
      if (!signatureValid(row, secret)) throw new Error("Signature invalide : prolongation refusée.");
      const expires = Math.min(Number(row.expires_at) + extra, now + MAX_DURATION_MS);
      const signed = { ...row, expires_at: expires };
      update("UPDATE authority_requests SET expires_at = ?, signature = ?, reminded = 0, nonce = ? WHERE id = ? AND status = 'active'", expires, sign(signed, secret), rotate, row.id);
      result = { status: "active", expiresAt: expires };
    } else {
      throw new Error("Décision inconnue.");
    }
    log(db, row, action, actorId, result.expiresAt ? new Date(result.expiresAt).toISOString() : null, now);
    db.exec("COMMIT");
    return { ok: true, ...result, nonce: rotate };
  } catch (error) {
    db.exec("ROLLBACK");
    return { error: error instanceof Error ? error.message : "Décision impossible." };
  }
}

/**
 * The check every service calls when its normal control refuses. Never throws: any problem
 * (database, signature, expired, other server) answers false.
 */
export function hasException({ guildId, userId, permission }, { db = defaultDb, env = process.env, now = Date.now() } = {}) {
  try {
    if (!EXCEPTIONABLE.includes(permission)) return false;
    const ownerId = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
    if (ownerId && userId === ownerId) return false;
    ensureAuthorityTables(db);
    const secret = secretOf(env);
    const rows = db.prepare("SELECT * FROM authority_requests WHERE guild_id = ? AND beneficiary_id = ? AND permission = ? AND status = 'active'").all(String(guildId), String(userId), permission);
    return rows.some((row) => Number(row.starts_at) <= now && Number(row.expires_at) > now && signatureValid(row, secret));
  } catch {
    return false;
  }
}

/** Context helper for core-permissions decide(): exception: authorityExceptionFor(guildId). */
export const authorityExceptionFor = (guildId, options) => ({ action, actorId }) => hasException({ guildId, userId: actorId, permission: action }, options);

export function listRequests(guildId, { status = null, userId = null, db = defaultDb, now = Date.now(), limit = 20 } = {}) {
  ensureAuthorityTables(db);
  const rows = db.prepare("SELECT * FROM authority_requests WHERE guild_id = ? ORDER BY id DESC LIMIT 200").all(String(guildId));
  return rows
    .map((row) => ({ ...row, effective: effectiveStatus(row, now) }))
    .filter((row) => (!status || row.effective === status) && (!userId || row.requester_id === userId || row.beneficiary_id === userId))
    .slice(0, limit);
}

export function requestHistory(guildId, number, { db = defaultDb } = {}) {
  ensureAuthorityTables(db);
  const row = getRequest(guildId, number, { db });
  if (!row) return [];
  return db.prepare("SELECT kind, actor_id, detail, created_at FROM authority_events WHERE request_id = ? ORDER BY id").all(row.id);
}

/** Marks expired rows (history and notifications) — the check never depends on this job. */
export function expireDue({ db = defaultDb, now = Date.now() } = {}) {
  ensureAuthorityTables(db);
  const due = db.prepare("SELECT * FROM authority_requests WHERE status = 'active' AND expires_at <= ?").all(now);
  for (const row of due) {
    db.prepare("UPDATE authority_requests SET status = 'expired' WHERE id = ? AND status = 'active'").run(row.id);
    log(db, row, "expire", "system", null, now);
  }
  return due;
}

/** Active exceptions ending within `withinMs`, reminded once (for the OWNER and the beneficiary). */
export function takeExpiryReminders({ db = defaultDb, now = Date.now(), withinMs = 24 * 3_600_000 } = {}) {
  ensureAuthorityTables(db);
  const rows = db.prepare("SELECT * FROM authority_requests WHERE status = 'active' AND reminded = 0 AND expires_at > ? AND expires_at <= ?").all(now, now + withinMs);
  const mark = db.prepare("UPDATE authority_requests SET reminded = 1 WHERE id = ? AND reminded = 0");
  return rows.filter((row) => mark.run(row.id).changes === 1);
}
