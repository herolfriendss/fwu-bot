import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_MISSIONS, advanceMission, missionDate } from "./mission-policy.js";

test("daily mission catalog has unique bounded tasks and positive rewards", () => {
  assert.equal(new Set(DAILY_MISSIONS.map((mission) => mission.key)).size, DAILY_MISSIONS.length);
  for (const mission of DAILY_MISSIONS) {
    assert.ok(mission.target > 0);
    assert.ok(mission.reward > 0);
  }
});

test("mission progress caps at the target and rejects invalid input", () => {
  assert.deepEqual(advanceMission(1, 3), { progress: 2, completed: false });
  assert.deepEqual(advanceMission(2, 3, 5), { progress: 3, completed: true });
  assert.throws(() => advanceMission(-1, 3), /invalide/);
});

test("mission date uses a stable UTC calendar key", () => {
  assert.equal(missionDate(Date.UTC(2026, 0, 2, 23, 59)), "2026-01-02");
});
