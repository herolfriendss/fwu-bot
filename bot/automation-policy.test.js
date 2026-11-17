import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAllowedGuildIds } from "./automation-policy.js";

test("scheduled automation accepts only unique valid Discord guild IDs", () => {
  assert.deepEqual(
    normalizeAllowedGuildIds(["123456789012345678", "123456789012345678", "not-an-id", "", null]),
    ["123456789012345678"],
  );
});

test("scheduled automation fails closed for an absent or invalid allowlist", () => {
  assert.deepEqual(normalizeAllowedGuildIds(undefined), []);
  assert.deepEqual(normalizeAllowedGuildIds([]), []);
  assert.deepEqual(normalizeAllowedGuildIds(["\\\\d12345"]), []);
});
