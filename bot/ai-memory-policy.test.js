import test from "node:test";
import assert from "node:assert/strict";
import { canUseAiMemory } from "./ai-memory-policy.js";

test("la mémoire IA exige le consentement du serveur et du membre", () => {
  assert.equal(canUseAiMemory(false, false), false);
  assert.equal(canUseAiMemory(false, true), false);
  assert.equal(canUseAiMemory(true, false), false);
  assert.equal(canUseAiMemory(true, true), true);
});
