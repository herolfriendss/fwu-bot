import test from "node:test";
import assert from "node:assert/strict";
import { getPndPresenceFrame, PND_PRESENCE_FRAMES, PND_PRESENCE_INTERVAL_MS } from "./rich-presence-policy.js";

test("PND presence rotates only through the configured identity frames", () => {
  assert.equal(PND_PRESENCE_FRAMES.length, 3);
  assert.ok(PND_PRESENCE_FRAMES.every((frame) => typeof frame.name === "string" && frame.name.length > 0));
  assert.deepEqual(getPndPresenceFrame(0), PND_PRESENCE_FRAMES[0]);
  assert.deepEqual(getPndPresenceFrame(3), PND_PRESENCE_FRAMES[0]);
  assert.deepEqual(getPndPresenceFrame(-1), PND_PRESENCE_FRAMES[1]);
  assert.deepEqual(getPndPresenceFrame(Number.NaN), PND_PRESENCE_FRAMES[0]);
});

test("PND presence refresh interval is bounded and stable", () => {
  assert.equal(PND_PRESENCE_INTERVAL_MS, 45_000);
});
