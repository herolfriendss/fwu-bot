import test from "node:test";
import assert from "node:assert/strict";
import { createPndIntelligenceRateLimiter } from "./pnd-intelligence-rate-limit.js";

test("planner rate limit is scoped per guild/member and resets after the window", () => {
  const limiter = createPndIntelligenceRateLimiter({ windowMs: 60_000, maxRequests: 3 });
  assert.equal(limiter.take("guild-a:user-a", 1_000), true);
  assert.equal(limiter.take("guild-a:user-a", 2_000), true);
  assert.equal(limiter.take("guild-a:user-a", 3_000), true);
  assert.equal(limiter.take("guild-a:user-a", 4_000), false);
  assert.equal(limiter.take("guild-b:user-a", 4_000), true);
  assert.equal(limiter.take("guild-a:user-a", 61_001), true);
});

test("planner limiter prunes expired keys when its key budget is exceeded", () => {
  const limiter = createPndIntelligenceRateLimiter({ windowMs: 100, maxRequests: 1, maxKeys: 2 });
  limiter.take("a", 0);
  limiter.take("b", 0);
  limiter.take("c", 200);
  assert.ok(limiter.size <= 2);
});
