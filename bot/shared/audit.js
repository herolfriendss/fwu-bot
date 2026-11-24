// FWU — journaux centraux (usages, dépassements de quota, sanctions).
// Écrits dans la base centrale. Si elle est injoignable, chaque entrée est
// gardée dans une file locale bornée (JSON Lines) puis renvoyée à la
// reconnexion : aucun journal n'est perdu lors d'une coupure courte.
// Les modifications de configuration ne passent PAS par ici : elles sont
// écrites dans la même transaction que la modification elle-même.
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dataPath } from "../data-dir.js";
import { isConnectionError, onSharedDbAvailability, sharedDbAvailable, sharedDbInitialized, sharedQuery } from "./db.js";

const OUTBOX_MAX_LINES = 10_000;
let outboxPath = process.env.SHARED_LOG_OUTBOX_PATH || dataPath("shared-log-outbox.jsonl");
let flushing = false;

export function setOutboxPathForTests(path) { outboxPath = path; }

const INSERTS = {
  command_usage: {
    sql: `INSERT INTO command_usage(guild_id, user_id, bot, command, target_id, outcome, detail, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    params: (e) => [e.guildId, e.userId, e.bot, e.command, e.targetId ?? null, e.outcome, e.detail ?? null, e.at],
  },
  quota_violations: {
    sql: `INSERT INTO quota_violations(guild_id, user_id, bot, command, tier, max_uses, window_seconds, retry_after_seconds, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    params: (e) => [e.guildId, e.userId, e.bot, e.command, e.tier ?? null, e.maxUses ?? null, e.windowSeconds ?? null, e.retryAfterSeconds ?? null, e.at],
  },
  sanctions: {
    sql: `INSERT INTO sanctions(guild_id, target_id, moderator_id, action, sanction_type_id, sanction_label, reason, duration_seconds, bot, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    params: (e) => [e.guildId, e.targetId, e.moderatorId, e.action, e.sanctionTypeId ?? null, e.sanctionLabel ?? null, String(e.reason ?? "").slice(0, 1000), e.durationSeconds ?? null, e.bot, e.at],
  },
};

function bufferEntry(table, entry) {
  try {
    appendFileSync(outboxPath, `${JSON.stringify({ table, entry })}\n`, { mode: 0o600 });
    trimOutbox();
  } catch { /* disque plein : rien d'autre à faire, la commande ne doit pas échouer pour un log */ }
}

function trimOutbox() {
  const lines = readFileSync(outboxPath, "utf8").split("\n").filter(Boolean);
  if (lines.length <= OUTBOX_MAX_LINES) return;
  writeFileSync(outboxPath, `${lines.slice(-OUTBOX_MAX_LINES).join("\n")}\n`, { mode: 0o600 });
}

async function write(table, entry) {
  const spec = INSERTS[table];
  const full = { ...entry, at: entry.at ?? new Date().toISOString() };
  // No central database configured at all: nothing to buffer (outages only).
  if (!sharedDbInitialized()) return { stored: "disabled" };
  if (!sharedDbAvailable()) {
    bufferEntry(table, full);
    return { stored: "outbox" };
  }
  try {
    await sharedQuery(spec.sql, spec.params(full));
    return { stored: "db" };
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    bufferEntry(table, full);
    return { stored: "outbox" };
  }
}

export function logCommandUsage(entry) { return write("command_usage", entry).catch(() => ({ stored: "lost" })); }
export function logQuotaViolation(entry) { return write("quota_violations", entry).catch(() => ({ stored: "lost" })); }
/** Sanction history row. Throws on a non-connection SQL error (bad data must be visible). */
export function recordSanction(entry) { return write("sanctions", entry); }

/** Re-send buffered entries. Entries that still fail stay in the file. */
export async function flushOutbox() {
  if (flushing || !existsSync(outboxPath) || !sharedDbAvailable()) return 0;
  flushing = true;
  const working = `${outboxPath}.flushing`;
  let sent = 0;
  try {
    renameSync(outboxPath, working);
    const lines = readFileSync(working, "utf8").split("\n").filter(Boolean);
    const remaining = [];
    for (const [index, line] of lines.entries()) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      const spec = INSERTS[parsed?.table];
      if (!spec) continue;
      try {
        await sharedQuery(spec.sql, spec.params(parsed.entry));
        sent++;
      } catch (error) {
        if (isConnectionError(error)) { remaining.push(...lines.slice(index)); break; }
        // Ligne invalide : on l'abandonne plutôt que de bloquer la file.
      }
    }
    if (remaining.length) appendFileSync(outboxPath, `${remaining.join("\n")}\n`, { mode: 0o600 });
    rmSync(working, { force: true });
  } catch { /* renvoi au prochain passage */ }
  finally { flushing = false; }
  return sent;
}

export function pendingOutboxEntries() {
  try { return readFileSync(outboxPath, "utf8").split("\n").filter(Boolean).length; } catch { return 0; }
}

let flushTimer = null;
/** Flush on reconnection and every minute. */
export function startOutboxFlusher() {
  onSharedDbAvailability((up) => { if (up) void flushOutbox(); });
  if (!flushTimer) {
    flushTimer = setInterval(() => { void flushOutbox(); }, 60_000);
    flushTimer.unref?.();
  }
}
