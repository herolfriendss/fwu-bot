import test from "node:test";
import assert from "node:assert/strict";
import { guardianSignalFromMessage, scoreGuardianSignals } from "./guardian-risk-policy.js";

test("Guardian records only bounded metadata signals and no message content", () => {
  assert.deepEqual(guardianSignalFromMessage({ mentionCount: 4, linkCount: 2, rapidCount: 4 }), []);
  assert.deepEqual(guardianSignalFromMessage({ mentionCount: 8, linkCount: 3, rapidCount: 6 }), [
    { signal: "mention_flood", observed: 8 },
    { signal: "link_flood", observed: 3 },
    { signal: "rapid_messages", observed: 6 },
  ]);
});

test("Guardian score is informational, capped, and requests human review at threshold", () => {
  const assessment = scoreGuardianSignals([
    { signal: "mention_flood", observed: 8 },
    { signal: "link_flood", observed: 3 },
  ]);
  assert.equal(assessment.score, 55);
  assert.equal(assessment.severity, "review");
  assert.equal(assessment.requiresReview, true);
  assert.equal(scoreGuardianSignals(Array.from({ length: 9 }, () => ({ signal: "rapid_messages", observed: 9 }))).score, 75);
  assert.equal(scoreGuardianSignals([]).severity, "none");
});
