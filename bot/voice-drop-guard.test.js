import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceDropGuard, nextRegion } from "./voice-drop-guard.js";

test("a burst of disconnections in one channel triggers once, with recent joiners as suspects", () => {
  let t = 1_000_000;
  const guard = createVoiceDropGuard({ now: () => t });
  guard.join("g", "v", "old"); t += 5 * 60_000;
  guard.join("g", "v", "intrus"); t += 30_000;
  assert.equal(guard.disconnect("g", "v", "a", 4), null);
  t += 1_000; assert.equal(guard.disconnect("g", "v", "b", 3), null);
  t += 1_000; const hit = guard.disconnect("g", "v", "c", 2);
  assert.deepEqual(hit, { dropped: ["a", "b", "c"], suspects: ["intrus"] });
  t += 1_000; assert.equal(guard.disconnect("g", "v", "d", 1), null, "pas deux fois pendant le délai de 2 min");
});

test("ordinary departures never trigger", () => {
  let t = 0;
  const guard = createVoiceDropGuard({ now: () => t });
  for (const id of ["a", "b", "c", "d"]) { t += 10_000; assert.equal(guard.disconnect("g", "v", id, 10), null, "départs espacés"); }
  t += 60_000;
  assert.equal(guard.disconnect("g", "w", "a", 20), null);
  assert.equal(guard.disconnect("g", "w", "b", 19), null);
  assert.equal(guard.disconnect("g", "w", "c", 18), null, "3 départs sur 21 : moins de la moitié du salon");
  assert.equal(guard.disconnect("g", "w", "c", 18), null, "le même membre compte une fois");
});

test("channels are counted separately and the region rotates", () => {
  let t = 0;
  const guard = createVoiceDropGuard({ now: () => t });
  guard.disconnect("g", "v1", "a", 0); guard.disconnect("g", "v2", "b", 0);
  assert.equal(guard.disconnect("g", "v1", "c", 0), null);
  assert.equal(nextRegion(null), "rotterdam");
  assert.equal(nextRegion("rotterdam"), null);
  assert.equal(nextRegion("us-east"), "rotterdam");
});
