// FWU CORE 2.2 — file persistante de tâches entre les bots.
//
// Le bus d'événements (event-bus.js) diffuse « ce qui s'est passé » à qui veut l'entendre.
// Cette file sert à autre chose : confier une TÂCHE à UN bot précis (« LE FISC : crédite 50 PND
// au gagnant », « DISPATCH : envoie ce rappel »), qui doit être faite une fois, même si le bot
// destinataire est arrêté au moment de la demande. Elle repose sur le SQLite partagé :
//
//   • idempotence : une clé (par serveur) ne crée jamais deux tâches ;
//   • bail : un bot « prend » une tâche pour un temps limité ; s'il plante, elle redevient
//     disponible à l'expiration du bail (jamais perdue, jamais faite deux fois en parallèle) ;
//   • reprises : échec → nouvel essai plus tard (30 s, 1, 2, 4… min, max 1 h), puis
//     « en échec définitif » après MAX_ATTEMPTS, visible pour le staff, jamais supprimée sans trace ;
//   • isolation : chaque tâche porte son serveur ; un bot ne traite que son profil.
// Un bot indisponible n'arrête donc rien : ses tâches attendent son retour.
import { randomUUID } from "node:crypto";
import { db as defaultDb } from "./database.js";

export const MAX_ATTEMPTS = 8;
export const LEASE_MS = 2 * 60_000;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;
const PAYLOAD_MAX = 8_000;
const DONE_RETENTION_MS = 14 * 86_400_000;

export function ensureQueueTables(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source TEXT NOT NULL,
      idem_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_try_at INTEGER NOT NULL,
      lease_holder TEXT, lease_until INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL, finished_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS core_jobs_idem ON core_jobs(guild_id, idem_key) WHERE idem_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS core_jobs_ready ON core_jobs(target, status, next_try_at);
  `);
}

export const retryDelayMs = (attempts) => Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1));

/** Adds a job for `target` (a bot profile). Same idempotency key on the same server → same job. */
export function enqueueJob({ guildId, target, kind, payload = {}, source, idempotencyKey = null, delayMs = 0 }, { db = defaultDb, now = Date.now() } = {}) {
  ensureQueueTables(db);
  if (!/^\d{5,25}$/.test(String(guildId ?? ""))) throw new Error("Serveur invalide pour la tâche.");
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(String(target ?? ""))) throw new Error("Destinataire invalide.");
  if (!/^[a-z][a-z0-9_.-]{1,60}$/.test(String(kind ?? ""))) throw new Error("Type de tâche invalide.");
  const json = JSON.stringify(payload ?? {});
  if (json.length > PAYLOAD_MAX) throw new Error("Tâche trop volumineuse.");
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
  if (key) {
    const existing = db.prepare("SELECT id, uid, status FROM core_jobs WHERE guild_id = ? AND idem_key = ?").get(String(guildId), key);
    if (existing) return { id: Number(existing.id), uid: existing.uid, duplicate: true, status: existing.status };
  }
  const uid = randomUUID();
  const info = db.prepare(`INSERT INTO core_jobs(uid, guild_id, target, kind, payload_json, source, idem_key, next_try_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, String(guildId), target, kind, json, String(source ?? "unknown").slice(0, 30), key, now + Math.max(0, delayMs), now);
  return { id: Number(info.lastInsertRowid), uid, duplicate: false, status: "pending" };
}

/**
 * Takes up to `limit` ready jobs for `target`, atomically: a job is leased by one holder only.
 * Jobs whose lease expired (holder crashed) are taken again.
 */
export function claimJobs(target, holder, { db = defaultDb, now = Date.now(), limit = 10, guildIds = null } = {}) {
  ensureQueueTables(db);
  const rows = db.prepare(`SELECT id, guild_id FROM core_jobs WHERE target = ?
    AND ((status = 'pending' AND next_try_at <= ?) OR (status = 'running' AND lease_until <= ?))
    ORDER BY next_try_at, id LIMIT ?`).all(target, now, now, Math.min(100, limit * 3));
  const allowed = guildIds ? new Set(guildIds.map(String)) : null;
  const take = db.prepare(`UPDATE core_jobs SET status = 'running', lease_holder = ?, lease_until = ?, attempts = attempts + 1
    WHERE id = ? AND ((status = 'pending' AND next_try_at <= ?) OR (status = 'running' AND lease_until <= ?))`);
  const claimed = [];
  for (const row of rows) {
    if (claimed.length >= limit) break;
    if (allowed && !allowed.has(row.guild_id)) continue;
    if (take.run(holder, now + LEASE_MS, row.id, now, now).changes !== 1) continue;
    const job = db.prepare("SELECT * FROM core_jobs WHERE id = ?").get(row.id);
    claimed.push({ id: Number(job.id), uid: job.uid, guildId: job.guild_id, kind: job.kind, payload: JSON.parse(job.payload_json), source: job.source, attempts: Number(job.attempts) });
  }
  return claimed;
}

/** Only the current holder may finish a job (a late, expired holder cannot overwrite). */
export function completeJob(id, holder, { db = defaultDb, now = Date.now() } = {}) {
  ensureQueueTables(db);
  return db.prepare("UPDATE core_jobs SET status = 'done', finished_at = ?, lease_holder = NULL, lease_until = NULL, last_error = NULL WHERE id = ? AND status = 'running' AND lease_holder = ?")
    .run(now, id, holder).changes === 1;
}

/** Failure: retry later with a growing pause, or "dead" after MAX_ATTEMPTS (kept for the staff). */
export function failJob(id, holder, error, { db = defaultDb, now = Date.now(), permanent = false } = {}) {
  ensureQueueTables(db);
  const job = db.prepare("SELECT attempts FROM core_jobs WHERE id = ? AND status = 'running' AND lease_holder = ?").get(id, holder);
  if (!job) return null;
  const message = String(error?.message ?? error ?? "erreur").replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[secret]").slice(0, 200);
  const dead = permanent || Number(job.attempts) >= MAX_ATTEMPTS;
  db.prepare(`UPDATE core_jobs SET status = ?, next_try_at = ?, lease_holder = NULL, lease_until = NULL, last_error = ?, finished_at = ? WHERE id = ?`)
    .run(dead ? "dead" : "pending", dead ? now : now + retryDelayMs(Number(job.attempts)), message, dead ? now : null, id);
  return dead ? "dead" : "retry";
}

/**
 * Runs the ready jobs of `target` with `handlers[kind]`. A missing handler (job from a newer
 * version) is retried later rather than lost. Returns counters.
 */
export async function runJobs(target, holder, handlers, options = {}) {
  const jobs = claimJobs(target, holder, options);
  const result = { done: 0, retry: 0, dead: 0 };
  for (const job of jobs) {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`Aucun traitement pour « ${job.kind} » dans cette version.`);
      await handler(job);
      if (completeJob(job.id, holder, options)) result.done += 1;
    } catch (error) {
      const outcome = failJob(job.id, holder, error, { ...options, permanent: error?.permanent === true });
      if (outcome) result[outcome] += 1;
    }
  }
  return result;
}

export function queueStats({ db = defaultDb, guildId = null } = {}) {
  ensureQueueTables(db);
  const rows = guildId
    ? db.prepare("SELECT target, status, COUNT(*) AS n FROM core_jobs WHERE guild_id = ? GROUP BY target, status").all(String(guildId))
    : db.prepare("SELECT target, status, COUNT(*) AS n FROM core_jobs GROUP BY target, status").all();
  return rows.map((r) => ({ target: r.target, status: r.status, count: Number(r.n) }));
}

export function deadJobs({ db = defaultDb, guildId = null, limit = 20 } = {}) {
  ensureQueueTables(db);
  return (guildId
    ? db.prepare("SELECT id, uid, guild_id, target, kind, attempts, last_error, finished_at FROM core_jobs WHERE status = 'dead' AND guild_id = ? ORDER BY id DESC LIMIT ?").all(String(guildId), limit)
    : db.prepare("SELECT id, uid, guild_id, target, kind, attempts, last_error, finished_at FROM core_jobs WHERE status = 'dead' ORDER BY id DESC LIMIT ?").all(limit));
}

/** A dead job put back in the queue by the staff (never automatic). */
export function retryDeadJob(id, { db = defaultDb, now = Date.now() } = {}) {
  ensureQueueTables(db);
  return db.prepare("UPDATE core_jobs SET status = 'pending', attempts = 0, next_try_at = ?, finished_at = NULL WHERE id = ? AND status = 'dead'").run(now, id).changes === 1;
}

/** Finished jobs are kept 14 days, then removed. Dead jobs are kept until handled. */
export function pruneJobs({ db = defaultDb, now = Date.now() } = {}) {
  ensureQueueTables(db);
  return db.prepare("DELETE FROM core_jobs WHERE status = 'done' AND finished_at < ?").run(now - DONE_RETENTION_MS).changes;
}
