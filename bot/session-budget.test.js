import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  DEFAULT_SESSION_RESERVE,
  FREE_STARTS_PER_WINDOW,
  MAX_WAIT_MS,
  START_BACKOFF_BASE_MS,
  START_BACKOFF_MAX_MS,
  fetchSessionStartLimit,
  gatewayStartStats,
  parseSessionStartLimit,
  planGatewayLogin,
  recordGatewayStart,
  sessionBudgetWaitMs,
  sessionReserveFromEnv,
  startBackoffMs,
  writeSessionWaitMarker,
  clearSessionWaitMarker,
} from "./session-budget.js";

const MIN = 60_000;
const memoryDb = () => new DatabaseSync(":memory:");
const okFetch = (limit) => async () => ({ ok: true, json: async () => ({ url: "wss://x", shards: 1, session_start_limit: limit }) });

test("the first starts of the window are free", () => {
  const db = memoryDb();
  for (let i = 0; i < FREE_STARTS_PER_WINDOW - 1; i++) recordGatewayStart(db, "guard", i * MIN);
  const stats = gatewayStartStats(db, "guard", 5 * MIN);
  assert.equal(stats.recent, FREE_STARTS_PER_WINDOW - 1);
  assert.equal(startBackoffMs(stats, 5 * MIN), 0);
});

test("a restart loop gets a growing pause, capped, whatever caused the restarts", () => {
  assert.equal(startBackoffMs({ recent: FREE_STARTS_PER_WINDOW, lastAt: 0 }, 0), START_BACKOFF_BASE_MS);
  assert.equal(startBackoffMs({ recent: FREE_STARTS_PER_WINDOW + 1, lastAt: 0 }, 0), 2 * START_BACKOFF_BASE_MS);
  assert.equal(startBackoffMs({ recent: FREE_STARTS_PER_WINDOW + 50, lastAt: 0 }, 0), START_BACKOFF_MAX_MS);
  // The pause counts from the previous start: a bot that stayed up long enough owes nothing.
  assert.equal(startBackoffMs({ recent: FREE_STARTS_PER_WINDOW, lastAt: 0 }, START_BACKOFF_BASE_MS + 1), 0);
});

test("a loop restarting every 5 s spends at most a few dozen sessions a day", () => {
  const db = memoryDb();
  let t = 0; let starts = 0;
  while (t < 24 * 3_600_000) {
    const wait = startBackoffMs(gatewayStartStats(db, "fisc", t), t);
    t += wait;
    recordGatewayStart(db, "fisc", t); starts++;
    t += 5_000; // crash 5 s after connecting, PM2 restart_delay
  }
  assert.ok(starts < 100, `${starts} starts`);
});

test("profiles and old rows are counted separately", () => {
  const db = memoryDb();
  for (let i = 0; i < 10; i++) recordGatewayStart(db, "guard", 0);
  assert.equal(gatewayStartStats(db, "fisc", MIN).recent, 0);
  assert.equal(gatewayStartStats(db, "guard", 7 * 3_600_000).recent, 0);
  recordGatewayStart(db, "guard", 25 * 3_600_000); // prunes rows older than 24 h
  assert.equal(gatewayStartStats(db, "guard", 25 * 3_600_000).day, 1);
});

test("Discord budget: wait for the reset only at or below the reserve", () => {
  assert.equal(sessionBudgetWaitMs({ total: 1000, remaining: 500, resetAfterMs: 1000 }), 0);
  assert.equal(sessionBudgetWaitMs({ total: 1000, remaining: DEFAULT_SESSION_RESERVE + 1, resetAfterMs: 1000 }), 0);
  assert.equal(sessionBudgetWaitMs({ total: 1000, remaining: DEFAULT_SESSION_RESERVE, resetAfterMs: 10 * MIN }), 11 * MIN);
  assert.equal(sessionBudgetWaitMs({ total: 1000, remaining: 0, resetAfterMs: 48 * 3_600_000 }), MAX_WAIT_MS);
  assert.equal(sessionBudgetWaitMs(null), 0);
});

test("payload parsing and reserve setting reject bad values", () => {
  assert.deepEqual(parseSessionStartLimit({ session_start_limit: { total: 1000, remaining: 3, reset_after: 42, max_concurrency: 1 } }), { total: 1000, remaining: 3, resetAfterMs: 42 });
  assert.equal(parseSessionStartLimit({}), null);
  assert.equal(parseSessionStartLimit({ session_start_limit: { total: "x" } }), null);
  assert.equal(sessionReserveFromEnv(undefined), DEFAULT_SESSION_RESERVE);
  assert.equal(sessionReserveFromEnv("25"), 25);
  assert.equal(sessionReserveFromEnv("-1"), DEFAULT_SESSION_RESERVE);
  assert.equal(sessionReserveFromEnv("abc"), DEFAULT_SESSION_RESERVE);
});

test("fetch failures never block the login and never leak the token", async () => {
  assert.equal(await fetchSessionStartLimit("t", { fetchImpl: async () => { throw new Error("network"); } }), null);
  assert.equal(await fetchSessionStartLimit("t", { fetchImpl: async () => ({ ok: false, status: 401 }) }), null);
  assert.equal(await fetchSessionStartLimit("", { fetchImpl: okFetch({ total: 1, remaining: 0, reset_after: 1 }) }), null);
  let seen;
  await fetchSessionStartLimit("secret", { fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({}) }; } });
  assert.equal(seen.url, "https://discord.com/api/v10/gateway/bot");
  assert.equal(seen.init.headers.Authorization, "Bot secret");
});

test("planGatewayLogin combines both checks", async () => {
  const db = memoryDb();
  const now = () => 10 * MIN;
  assert.deepEqual(
    (({ waitMs, reason }) => ({ waitMs, reason }))(await planGatewayLogin({ db, profile: "guard", token: "t", now, fetchImpl: okFetch({ total: 1000, remaining: 900, reset_after: 0 }) })),
    { waitMs: 0, reason: "ok" },
  );
  const low = await planGatewayLogin({ db, profile: "guard", token: "t", now, fetchImpl: okFetch({ total: 1000, remaining: 2, reset_after: 30 * MIN }) });
  assert.equal(low.reason, "session_reserve");
  assert.equal(low.waitMs, 31 * MIN);
  assert.equal(low.remaining, 2);
  for (let i = 0; i < 6; i++) recordGatewayStart(db, "guard", 10 * MIN);
  const loop = await planGatewayLogin({ db, profile: "guard", token: "t", now, fetchImpl: async () => { throw new Error("down"); } });
  assert.equal(loop.reason, "start_backoff");
  assert.ok(loop.waitMs > 0);
  assert.equal(loop.remaining, null);
});

test("the wait marker tells installers the delay is deliberate", () => {
  const path = join(mkdtempSync(join(tmpdir(), "fwu-wait-")), ".session-wait");
  writeSessionWaitMarker(123_456, "start_backoff", path);
  assert.equal(readFileSync(path, "utf8"), "123456 start_backoff\n");
  clearSessionWaitMarker(path);
  assert.equal(existsSync(path), false);
  clearSessionWaitMarker(path); // idempotent
});
