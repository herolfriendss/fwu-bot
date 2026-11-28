import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createFleetWatcher, describeFleetChange, profileState, watchedProfiles } from "./fleet-watch.js";
import { clearGatewayWait, listGatewayWaits, recentlyStartedProfiles, recordGatewayStart, recordGatewayWait } from "./session-budget.js";

const ALL = ["fwu", "guard", "fdpdlavoc", "suckme", "fisc", "investplus"];

test("state of a profile from the shared tables", () => {
  assert.equal(profileState({ lease: { live: true } }), "online");
  assert.equal(profileState({ lease: { live: false }, failure: { stopped: true } }), "stopped");
  assert.equal(profileState({ lease: null, wait: { until: 2_000 }, now: 1_000 }), "waiting");
  assert.equal(profileState({ lease: null, wait: { until: 500 }, now: 1_000, startedRecently: true }), "down");
  assert.equal(profileState({ lease: { live: false } }), "down");
  // Cleanly stopped bot: the lease row is deleted, the recent start still tells it ran here.
  assert.equal(profileState({ lease: null, startedRecently: true }), "down");
  // Never run on this VPS (Invest + without token, future bot): no alert.
  assert.equal(profileState({ lease: null }), "absent");
});

test("a normal restart raises nothing, a real outage raises one alert, then the return", () => {
  const w = createFleetWatcher({ stableTicks: 3 });
  for (let i = 0; i < 3; i++) assert.deepEqual(w.update({ guard: "online" }), []); // first state: remembered only
  assert.deepEqual(w.update({ guard: "down" }), []);
  assert.deepEqual(w.update({ guard: "online" }), []); // restart in < 3 checks
  assert.deepEqual(w.update({ guard: "down" }), []);
  assert.deepEqual(w.update({ guard: "down" }), []);
  assert.deepEqual(w.update({ guard: "down" }), [{ profile: "guard", from: "online", to: "down" }]);
  assert.deepEqual(w.update({ guard: "down" }), []); // no repeat
  for (let i = 0; i < 2; i++) w.update({ guard: "online" });
  assert.deepEqual(w.update({ guard: "online" }), [{ profile: "guard", from: "down", to: "online" }]);
});

test("a bot already stopped or waiting when the watcher starts is reported at once", () => {
  const w = createFleetWatcher({ stableTicks: 1 });
  assert.deepEqual(w.update({ guard: "stopped", fisc: "waiting", suckme: "online", investplus: "absent" }), [
    { profile: "guard", from: null, to: "stopped" },
    { profile: "fisc", from: null, to: "waiting" },
  ]);
});

test("an absent optional bot never alerts, even when it is installed later", () => {
  const w = createFleetWatcher({ stableTicks: 1 });
  assert.deepEqual(w.update({ investplus: "absent" }), []);
  assert.deepEqual(w.update({ investplus: "online" }), []);
  assert.deepEqual(w.update({ investplus: "down" }), [{ profile: "investplus", from: "online", to: "down" }]);
});

test("the main bot watches every other bot and SUCK ME watches the main bot", () => {
  assert.deepEqual(watchedProfiles("fwu", ALL), ["guard", "fdpdlavoc", "suckme", "fisc", "investplus"]);
  assert.deepEqual(watchedProfiles("suckme", ALL), ["fwu"]);
  assert.deepEqual(watchedProfiles("guard", ALL), []);
  // Future profiles are covered automatically.
  assert.ok(watchedProfiles("fwu", [...ALL, "authority"]).includes("authority"));
});

test("alert texts: owner told only for a definitive stop, never the product name", () => {
  const stopped = describeFleetChange({ from: "down", to: "stopped" }, "GUARD", { pm2Name: "fwu-guard" });
  assert.equal(stopped.owner, true);
  assert.match(stopped.description, /pm2 restart fwu-guard/);
  assert.equal(describeFleetChange({ from: "online", to: "down" }, "GUARD").owner, false);
  assert.equal(describeFleetChange({ from: "online", to: "waiting" }, "GUARD").owner, false);
  assert.equal(describeFleetChange({ from: "stopped", to: "online" }, "GUARD").owner, true);
  assert.equal(describeFleetChange({ from: "x", to: "absent" }, "GUARD"), null);
  for (const to of ["down", "waiting", "stopped", "online"]) {
    const text = describeFleetChange({ from: "online", to }, "LE FISC");
    assert.doesNotMatch(`${text.title} ${text.description}`.replace(/fwu-[a-z]+/g, ""), /FWU/i);
  }
});

test("waits and recent starts are shared through SQLite", () => {
  const db = new DatabaseSync(":memory:");
  recordGatewayWait(db, "fisc", 5_000, "session_reserve");
  assert.deepEqual(listGatewayWaits(db), [{ profile: "fisc", until: 5_000, reason: "session_reserve" }]);
  recordGatewayWait(db, "fisc", 9_000, "start_backoff");
  assert.equal(listGatewayWaits(db)[0].until, 9_000);
  clearGatewayWait(db, "fisc");
  assert.deepEqual(listGatewayWaits(db), []);
  recordGatewayStart(db, "guard", 1_000);
  assert.deepEqual([...recentlyStartedProfiles(db, 2_000)], ["guard"]);
  assert.deepEqual([...recentlyStartedProfiles(db, 1_000 + 25 * 3_600_000)], []);
});
