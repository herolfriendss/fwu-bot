// Silent-crash guard. A bot that never reaches Discord (wrong token, missing
// intents) or stays disconnected must exit with an error: PM2 then restarts it
// and counts the restart. Before this, the process stayed alive on its timers
// and PM2 showed it "online" while it was offline on Discord.
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STARTUP_LIMIT_MS = 2 * 60_000;
export const DISCONNECTED_LIMIT_MS = 5 * 60_000;
// Per-process marker (the bot's own folder, never the shared data folder):
// the installer waits for it to know the bot really reached Discord.
export const CONNECTED_MARKER = fileURLToPath(new URL("./.connected", import.meta.url));

/** Pure watchdog: call check() periodically; it calls exit(reason) at most once. */
export function createGatewayWatchdog({ isReady, exit, now = Date.now, startupLimitMs = STARTUP_LIMIT_MS, disconnectedLimitMs = DISCONNECTED_LIMIT_MS }) {
  const startedAt = now();
  let lastReadyAt = null;
  let exited = false;
  return {
    check() {
      if (exited) return null;
      const t = now();
      if (isReady()) { lastReadyAt = t; return null; }
      let reason = null;
      if (lastReadyAt === null && t - startedAt >= startupLimitMs) reason = "startup_timeout";
      else if (lastReadyAt !== null && t - lastReadyAt >= disconnectedLimitMs) reason = "disconnected_timeout";
      if (reason) { exited = true; exit(reason); }
      return reason;
    },
  };
}

export function clearConnectedMarker(path = CONNECTED_MARKER) {
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}

export function writeConnectedMarker(path = CONNECTED_MARKER) {
  try { writeFileSync(path, `${process.pid} ${new Date().toISOString()}\n`, { mode: 0o644 }); } catch { /* best effort */ }
}

// Growing pause before each restart, then a definitive stop: without it PM2
// would restart a bot with a wrong token in a loop. The counter lives in the
// shared SQLite file (one row per bot) so the diagnostic of every bot sees it.
export const RESTART_DELAYS_MS = Object.freeze([30_000, 60_000, 120_000, 240_000, 480_000]);
// PM2 does not restart a process that exits with this code (stop_exit_codes).
export const STOP_EXIT_CODE = 78;
const FAILURE_SERIES_MS = 30 * 60_000;

export function ensureGatewayFailureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_gateway_failures (
    profile TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    last_reason TEXT,
    last_at INTEGER NOT NULL,
    stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1))
  )`);
}

/** Records one failed connection and says what to do: wait then exit(1), or stop for good. */
export function recordGatewayFailure(db, profile, reason, now = Date.now()) {
  ensureGatewayFailureTable(db);
  const row = db.prepare("SELECT failures, last_at FROM bot_gateway_failures WHERE profile = ?").get(profile);
  // A failure older than the longest pause comes from an earlier series (e.g. a stop then a fix and a manual restart).
  const previous = row && now - Number(row.last_at) <= FAILURE_SERIES_MS ? Number(row.failures) : 0;
  const failures = previous + 1;
  const stop = failures > RESTART_DELAYS_MS.length;
  db.prepare(`INSERT INTO bot_gateway_failures(profile, failures, last_reason, last_at, stopped) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile) DO UPDATE SET failures = excluded.failures, last_reason = excluded.last_reason, last_at = excluded.last_at, stopped = excluded.stopped`)
    .run(profile, failures, String(reason).slice(0, 60), now, stop ? 1 : 0);
  return { failures, stop, delayMs: stop ? 0 : RESTART_DELAYS_MS[failures - 1], exitCode: stop ? STOP_EXIT_CODE : 1 };
}

export function clearGatewayFailures(db, profile) {
  ensureGatewayFailureTable(db);
  db.prepare("DELETE FROM bot_gateway_failures WHERE profile = ?").run(profile);
}

export function listGatewayFailures(db) {
  ensureGatewayFailureTable(db);
  return db.prepare("SELECT profile, failures, last_reason, last_at, stopped FROM bot_gateway_failures ORDER BY profile").all()
    .map((row) => ({ profile: row.profile, failures: Number(row.failures), reason: row.last_reason, at: Number(row.last_at), stopped: Boolean(row.stopped) }));
}
