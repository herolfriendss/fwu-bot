// FWU CORE 2.4 — journal d'audit unifié, en ajout seul et chaîné.
//
// Chaque ligne porte l'empreinte (SHA-256) de la ligne précédente du même serveur : modifier,
// supprimer ou insérer une ligne à la main dans la base casse la chaîne, et verifyAuditChain()
// le détecte. Avec PND_AUDIT_SECRET (côté serveur, jamais dans le code), l'empreinte devient un
// HMAC : même quelqu'un qui recalcule la chaîne ne peut pas la refaire sans le secret.
//
// Utilisé par les nouveaux services (AUTHORITY, CORE, STAFF CENTER) ; les journaux existants
// (sysplus_audit, config_changes, journaux typés) restent en place, rien n'est migré de force.
// Ne jamais y écrire de secret ni de contenu de message privé : seulement qui, quoi, sur quoi.
import { createHash, createHmac } from "node:crypto";
import { db as defaultDb } from "./database.js";

const DETAILS_MAX = 2_000;

export function ensureAuditTable(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL, seq INTEGER NOT NULL,
      at INTEGER NOT NULL, source TEXT NOT NULL, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, target TEXT, details_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL, hash TEXT NOT NULL,
      UNIQUE (guild_id, seq)
    );
    CREATE INDEX IF NOT EXISTS core_audit_action ON core_audit(guild_id, action, id);
  `);
}

const GENESIS = "0".repeat(64);

function digest(prev, row, secret) {
  const canonical = JSON.stringify([prev, row.guild_id, row.seq, row.at, row.source, row.actor_id, row.action, row.target ?? null, row.details_json]);
  return secret ? createHmac("sha256", secret).update(canonical).digest("hex") : createHash("sha256").update(canonical).digest("hex");
}

/** Removes anything that looks like a credential before it reaches the journal. */
export function scrubDetails(details) {
  const json = JSON.stringify(details ?? {}, (key, value) => {
    if (/token|secret|password|cookie|authorization/i.test(key)) return "[masqué]";
    if (typeof value === "string") return value.replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[masqué]").slice(0, 500);
    return value;
  });
  return json.length > DETAILS_MAX ? JSON.stringify({ truncated: true }) : json;
}

/** Appends one entry. Never throws to the caller's action: returns null when it cannot write. */
export function appendAudit({ guildId, source, actorId, action, target = null, details = {} }, { db = defaultDb, now = Date.now(), secret = process.env.PND_AUDIT_SECRET } = {}) {
  ensureAuditTable(db);
  if (!/^[a-z][a-z0-9_.-]{1,60}$/.test(String(action ?? ""))) throw new Error("Action d'audit invalide.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const last = db.prepare("SELECT seq, hash FROM core_audit WHERE guild_id = ? ORDER BY seq DESC LIMIT 1").get(String(guildId));
    const row = {
      guild_id: String(guildId), seq: (last ? Number(last.seq) : 0) + 1, at: now,
      source: String(source ?? "unknown").slice(0, 30), actor_id: String(actorId ?? "system").slice(0, 30),
      action: String(action), target: target === null ? null : String(target).slice(0, 120), details_json: scrubDetails(details),
    };
    const prev = last?.hash ?? GENESIS;
    const hash = digest(prev, row, secret || null);
    db.prepare(`INSERT INTO core_audit(guild_id, seq, at, source, actor_id, action, target, details_json, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.guild_id, row.seq, row.at, row.source, row.actor_id, row.action, row.target, row.details_json, prev, hash);
    db.exec("COMMIT");
    return { seq: row.seq, hash };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function appendAuditSafe(entry, options) {
  try { return appendAudit(entry, options); } catch { return null; }
}

/** Checks the whole chain of one server. Returns { ok, count, brokenAt } (first bad seq). */
export function verifyAuditChain(guildId, { db = defaultDb, secret = process.env.PND_AUDIT_SECRET } = {}) {
  ensureAuditTable(db);
  let prev = GENESIS; let expected = 1; let count = 0;
  for (const row of db.prepare("SELECT * FROM core_audit WHERE guild_id = ? ORDER BY seq").iterate(String(guildId))) {
    if (Number(row.seq) !== expected || row.prev_hash !== prev || digest(prev, row, secret || null) !== row.hash) return { ok: false, count, brokenAt: Number(row.seq) };
    prev = row.hash; expected += 1; count += 1;
  }
  return { ok: true, count, brokenAt: null };
}

export function listAudit(guildId, { action = null, actorId = null, limit = 50, db = defaultDb } = {}) {
  ensureAuditTable(db);
  const clauses = ["guild_id = ?"]; const args = [String(guildId)];
  if (action) { clauses.push("action LIKE ?"); args.push(`${String(action).replace(/[%_]/g, "")}%`); }
  if (actorId) { clauses.push("actor_id = ?"); args.push(String(actorId)); }
  return db.prepare(`SELECT seq, at, source, actor_id, action, target, details_json FROM core_audit WHERE ${clauses.join(" AND ")} ORDER BY seq DESC LIMIT ?`)
    .all(...args, Math.min(500, Math.max(1, Number(limit) || 50)))
    .map((r) => ({ seq: Number(r.seq), at: Number(r.at), source: r.source, actorId: r.actor_id, action: r.action, target: r.target, details: JSON.parse(r.details_json) }));
}

/** CSV export (owner tools, console). Formula-like cells are neutralised for spreadsheets. */
export function auditToCsv(entries) {
  const cell = (v) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return ["seq,date,source,acteur,action,cible,details", ...entries.map((e) => [e.seq, new Date(e.at).toISOString(), e.source, e.actorId, e.action, e.target, e.details].map(cell).join(","))].join("\n");
}
