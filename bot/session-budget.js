// Discord session budget guard, shared by every bot profile (fwu, guard, fdpdlavoc, suckme,
// fisc, investplus and the future ones): they all start through bot/index.js.
//
// Discord allows each application about 1000 session starts per 24 h. EVERY process start
// spends one, whatever the cause: crash, PM2 memory restart, deployment, rollback, manual
// restart. On 2026-11-26 GUARD and LE FISC emptied their budget through restart loops and
// stayed offline until Discord's reset. gateway-watchdog.js only slowed down *failed*
// connections; a bot that connects then crashes (or is restarted by PM2 for memory) was
// restarted every 5 s without limit.
//
// Two checks now run before every login:
//   1. Local start budget: each login attempt is recorded in the shared SQLite file
//      (one table, one row per attempt, per profile). Too many starts in the last 6 h → the process
//      waits before connecting, with a growing pause, whatever caused the restarts.
//   2. Discord budget: GET /gateway/bot (free, it does not spend a session) tells how many
//      starts remain. At or below a small reserve, the bot waits for Discord's reset instead
//      of spending the last ones.
// While a bot waits it does not hold its domain lease, so the main bot covers its domain.
// Any error in these checks lets the login go ahead (never block a bot on a diagnostic).
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const START_WINDOW_MS = 6 * 3_600_000;
export const FREE_STARTS_PER_WINDOW = 6;
export const START_BACKOFF_BASE_MS = 60_000;
export const START_BACKOFF_MAX_MS = 30 * 60_000;
export const DEFAULT_SESSION_RESERVE = 10;
export const MAX_WAIT_MS = 24 * 3_600_000;
const RESET_MARGIN_MS = 60_000;
// Per-process marker (the bot's own folder): present while the bot deliberately postpones its
// login. Installers read it so a postponed start is not mistaken for a broken update (which
// used to trigger a rollback, i.e. one more restart and one more session spent).
export const SESSION_WAIT_MARKER = fileURLToPath(new URL("./.session-wait", import.meta.url));
const HISTORY_MS = 24 * 3_600_000;

export function ensureGatewayStartTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_gateway_starts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile TEXT NOT NULL,
    started_at INTEGER NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS bot_gateway_starts_profile_at ON bot_gateway_starts(profile, started_at)");
}

/** Records one login attempt (call right before client.login) and prunes rows older than 24 h. */
export function recordGatewayStart(db, profile, now = Date.now()) {
  ensureGatewayStartTable(db);
  db.prepare("INSERT INTO bot_gateway_starts(profile, started_at) VALUES (?, ?)").run(String(profile), now);
  db.prepare("DELETE FROM bot_gateway_starts WHERE started_at < ?").run(now - HISTORY_MS);
}

/** Starts of this profile in the last window and in the last 24 h, plus the latest one. */
export function gatewayStartStats(db, profile, now = Date.now()) {
  ensureGatewayStartTable(db);
  const row = db.prepare(`SELECT
      SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS recent,
      COUNT(*) AS day,
      MAX(started_at) AS last
    FROM bot_gateway_starts WHERE profile = ? AND started_at >= ?`).get(now - START_WINDOW_MS, String(profile), now - HISTORY_MS);
  return { recent: Number(row?.recent ?? 0), day: Number(row?.day ?? 0), lastAt: row?.last == null ? null : Number(row.last) };
}

/** Pause owed before the next start, counted from the previous start. */
export function startBackoffMs({ recent, lastAt }, now = Date.now()) {
  if (recent < FREE_STARTS_PER_WINDOW || lastAt == null) return 0;
  const pause = Math.min(START_BACKOFF_MAX_MS, START_BACKOFF_BASE_MS * 2 ** (recent - FREE_STARTS_PER_WINDOW));
  return Math.max(0, lastAt + pause - now);
}

/** Reads Discord's session_start_limit object; null when the payload is not usable. */
export function parseSessionStartLimit(payload) {
  const limit = payload?.session_start_limit;
  if (!limit || typeof limit !== "object") return null;
  const total = Number(limit.total);
  const remaining = Number(limit.remaining);
  const resetAfterMs = Number(limit.reset_after);
  if (![total, remaining, resetAfterMs].every(Number.isFinite)) return null;
  return { total, remaining, resetAfterMs: Math.max(0, resetAfterMs) };
}

/** Wait owed to Discord's budget: none above the reserve, otherwise until the reset. */
export function sessionBudgetWaitMs(limit, reserve = DEFAULT_SESSION_RESERVE) {
  if (!limit || limit.remaining > reserve) return 0;
  return Math.min(MAX_WAIT_MS, limit.resetAfterMs + RESET_MARGIN_MS);
}

export function sessionReserveFromEnv(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 200 ? parsed : DEFAULT_SESSION_RESERVE;
}

/** GET /gateway/bot. Never throws and never prints the token; null on any problem. */
export async function fetchSessionStartLimit(token, { fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {}) {
  if (!token || typeof fetchImpl !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl("https://discord.com/api/v10/gateway/bot", {
      headers: { Authorization: `Bot ${token}` },
      signal: controller.signal,
    });
    if (!response?.ok) return null;
    return parseSessionStartLimit(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decides whether this process may log in now. Returns { waitMs, reason, ... };
 * reason is "ok", "start_backoff" (too many local restarts) or "session_reserve" (Discord budget).
 */
export async function planGatewayLogin({ db, profile, token, now = Date.now, reserve = DEFAULT_SESSION_RESERVE, fetchImpl } = {}) {
  let stats = { recent: 0, day: 0, lastAt: null };
  try { stats = gatewayStartStats(db, profile, now()); } catch { /* no local history: no local pause */ }
  const backoff = startBackoffMs(stats, now());
  const limit = await fetchSessionStartLimit(token, { fetchImpl });
  const budgetWait = sessionBudgetWaitMs(limit, reserve);
  const waitMs = Math.max(backoff, budgetWait);
  const reason = waitMs === 0 ? "ok" : budgetWait >= backoff ? "session_reserve" : "start_backoff";
  return { waitMs, reason, recentStarts: stats.recent, dayStarts: stats.day, remaining: limit?.remaining ?? null, total: limit?.total ?? null };
}

/** Writes "<until epoch ms> <reason>" so installers and diagnostics know the wait is deliberate. */
export function writeSessionWaitMarker(untilMs, reason, path = SESSION_WAIT_MARKER) {
  try { writeFileSync(path, `${Math.round(untilMs)} ${String(reason).slice(0, 40)}\n`, { mode: 0o644 }); } catch { /* best effort */ }
}

export function clearSessionWaitMarker(path = SESSION_WAIT_MARKER) {
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}
