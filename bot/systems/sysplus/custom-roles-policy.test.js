import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_ROLE_LIMITS,
  customRoleHierarchyDecision,
  customRoleQuotaDecision,
  normalizeCustomRoleColor,
  normalizeCustomRoleName,
} from "./custom-roles-policy.js";

test("custom role names and colors are bounded and safe", () => {
  assert.equal(normalizeCustomRoleName("  PND   Creator  "), "PND Creator");
  assert.equal(normalizeCustomRoleColor("#a1b2c3"), "#A1B2C3");
  assert.throws(() => normalizeCustomRoleName("x"), /entre 2 et 32/);
  assert.throws(() => normalizeCustomRoleName("@everyone"), /mentions/);
  assert.throws(() => normalizeCustomRoleName("x".repeat(33)), /entre 2 et 32/);
  assert.throws(() => normalizeCustomRoleColor("purple"), /#RRGGBB/);
});

test("each creator can have exactly one custom role, with a separate guild cap", () => {
  assert.equal(CUSTOM_ROLE_LIMITS.perCreator, 1);
  assert.deepEqual(customRoleQuotaDecision({ creatorCount: 0, guildCount: 0 }), { allowed: true, reason: null });
  assert.equal(customRoleQuotaDecision({ creatorCount: CUSTOM_ROLE_LIMITS.perCreator, guildCount: 0 }).allowed, false);
  assert.equal(customRoleQuotaDecision({ creatorCount: 0, guildCount: CUSTOM_ROLE_LIMITS.perGuild }).allowed, false);
});

test("custom role changes respect bot and actor role hierarchy", () => {
  const base = { actorIsGuildOwner: false, actorPosition: 10, botPosition: 20, rolePosition: 5, roleManaged: false, roleIsEveryone: false };
  assert.equal(customRoleHierarchyDecision(base).allowed, true);
  assert.equal(customRoleHierarchyDecision({ ...base, rolePosition: 10 }).allowed, false);
  assert.equal(customRoleHierarchyDecision({ ...base, rolePosition: 20, actorIsGuildOwner: true }).allowed, false);
  assert.equal(customRoleHierarchyDecision({ ...base, roleManaged: true }).allowed, false);
});
