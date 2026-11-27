import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearConnectedMarker, createGatewayWatchdog, writeConnectedMarker } from "./gateway-watchdog.js";

function harness(opts = {}) {
  let t = 0; let ready = false; const exits = [];
  const dog = createGatewayWatchdog({ isReady: () => ready, exit: (r) => exits.push(r), now: () => t, startupLimitMs: 100, disconnectedLimitMs: 50, ...opts });
  return { dog, exits, at: (v) => { t = v; }, setReady: (v) => { ready = v; } };
}

test("exits when Discord is never reached (wrong token, missing intents)", () => {
  const h = harness();
  h.at(99); assert.equal(h.dog.check(), null);
  h.at(100); assert.equal(h.dog.check(), "startup_timeout");
  h.at(500); h.dog.check();
  assert.deepEqual(h.exits, ["startup_timeout"]);
});

test("stays up while connected, exits after a long disconnection", () => {
  const h = harness();
  h.at(10); h.setReady(true); h.dog.check();
  h.at(1_000); h.dog.check();
  h.setReady(false);
  h.at(1_049); assert.equal(h.dog.check(), null);
  h.at(1_050); assert.equal(h.dog.check(), "disconnected_timeout");
  assert.deepEqual(h.exits, ["disconnected_timeout"]);
});

test("a short reconnection does not exit", () => {
  const h = harness();
  h.setReady(true); h.at(10); h.dog.check();
  h.setReady(false); h.at(40); h.dog.check();
  h.setReady(true); h.at(55); h.dog.check();
  h.setReady(false); h.at(90); h.dog.check();
  assert.deepEqual(h.exits, []);
});

test("connected marker is written and cleared", () => {
  const path = join(mkdtempSync(join(tmpdir(), "fwu-marker-")), ".connected");
  writeConnectedMarker(path);
  assert.match(readFileSync(path, "utf8"), new RegExp(`^${process.pid} `));
  clearConnectedMarker(path);
  assert.equal(existsSync(path), false);
});

test("growing pauses between restarts, then a definitive stop", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { recordGatewayFailure, clearGatewayFailures, listGatewayFailures, RESTART_DELAYS_MS, STOP_EXIT_CODE } = await import("./gateway-watchdog.js");
  const db = new DatabaseSync(":memory:");
  const plans = RESTART_DELAYS_MS.map((_, i) => recordGatewayFailure(db, "guard", "TokenInvalid", i));
  assert.deepEqual(plans.map((p) => p.delayMs), [...RESTART_DELAYS_MS]);
  assert.ok(plans.every((p) => !p.stop && p.exitCode === 1));
  const last = recordGatewayFailure(db, "guard", "TokenInvalid", 99);
  assert.deepEqual([last.stop, last.exitCode, last.failures], [true, STOP_EXIT_CODE, RESTART_DELAYS_MS.length + 1]);
  assert.deepEqual(listGatewayFailures(db).map((r) => [r.profile, r.stopped, r.reason]), [["guard", true, "TokenInvalid"]]);
  assert.equal(recordGatewayFailure(db, "guard", "TokenInvalid", 99 + 31 * 60_000).failures, 1, "une nouvelle série repart de zéro");
  recordGatewayFailure(db, "fisc", "startup_timeout", 1);
  clearGatewayFailures(db, "guard");
  assert.deepEqual(listGatewayFailures(db).map((r) => r.profile), ["fisc"]);
});

test("Discord's daily session limit makes the bot wait for the reset instead of restarting", async () => {
  const { parseSessionLimit } = await import("./gateway-watchdog.js");
  const now = Date.parse("2026-11-27T20:00:00Z");
  const hit = parseSessionLimit("Not enough sessions remaining to spawn 1 shards; remaining: 0, reset_after: 9000000, resets at 2026-11-27T22:36:00.000Z", now);
  assert.equal(hit.resetAt, Date.parse("2026-11-27T22:36:00Z"));
  assert.equal(hit.delayMs, 2 * 3_600_000 + 36 * 60_000 + 60_000);
  assert.equal(parseSessionLimit("Not enough sessions remaining", now).delayMs, 24 * 3_600_000, "sans heure : attente plafonnée à 24 h");
  assert.equal(parseSessionLimit("Not enough sessions remaining resets at 2026-11-27T19:00:00Z", now).delayMs, 60_000, "reset déjà passé : 1 min");
  assert.equal(parseSessionLimit("An invalid token was provided", now), null);
  assert.equal(parseSessionLimit(undefined, now), null);
});
