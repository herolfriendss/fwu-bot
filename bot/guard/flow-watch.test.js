import test from "node:test";
import assert from "node:assert/strict";
import { checkFlow, isAbnormal, recordFlow } from "./flow-watch.js";

test("abnormal joins/leaves compared with the same hour of the previous days", () => {
  assert.equal(isAbnormal(7, []).abnormal, false, "minimum 8");
  assert.equal(isAbnormal(8, [0, 0, 0]).abnormal, true);
  assert.equal(isAbnormal(10, [3, 3, 3, 3, 3, 3, 3]).abnormal, false, "3 × 3 + 3 = 12");
  assert.equal(isAbnormal(12, [3, 3, 3, 3, 3, 3, 3]).abnormal, true);
  const now = Date.UTC(2026, 10, 28, 14, 30);
  for (let i = 0; i < 9; i++) recordFlow("fg", "leave", now);
  recordFlow("fg", "join", now);
  const alerts = checkFlow("fg", now);
  assert.deepEqual(alerts.map((a) => [a.kind, a.count]), [["leaves", 9]]);
  assert.deepEqual(checkFlow("fg", now), [], "une seule alerte par heure");
});
