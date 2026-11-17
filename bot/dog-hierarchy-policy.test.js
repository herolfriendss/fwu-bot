import test from "node:test";
import assert from "node:assert/strict";
import { canApplyDogAction, canRemoveDogLeash, isBotAboveDogTarget } from "./dog-hierarchy-policy.js";

function role(id, position) {
  return {
    id,
    position,
    comparePositionTo(other) {
      return this.position - other.position;
    },
  };
}

function member(id, position, extraRoles = []) {
  const base = role(`role-${id}`, position);
  const everyone = role("everyone", 0);
  const roles = [everyone, base, ...extraRoles];
  const highest = roles.reduce((top, item) => item.comparePositionTo(top) > 0 ? item : top);
  return {
    id,
    guild: { roles: { everyone } },
    roles: { highest, cache: new Map(roles.map((item) => [item.id, item])) },
  };
}

const OWNER = "owner";

test("a member can DOG only a target strictly below their highest role", () => {
  assert.equal(canApplyDogAction(member("staff", 20), member("member", 10), OWNER), true);
  assert.equal(canApplyDogAction(member("staff", 10), member("same-rank", 10), OWNER), false);
  assert.equal(canApplyDogAction(member("staff", 10), member("senior", 20), OWNER), false);
});

test("only the server owner bypasses the invoker hierarchy comparison", () => {
  assert.equal(canApplyDogAction(member(OWNER, 0), member("admin", 100), OWNER), true);
  assert.equal(canApplyDogAction(member("admin", 100), member("staff", 20), OWNER), true);
  assert.equal(canApplyDogAction(member("staff", 20), member("admin", 100), OWNER), false);
});

test("the DOG marker role does not block the owner from removing the leash", () => {
  const actor = member("staff", 20);
  const target = member("member", 10, [role("dog-marker", 80)]);
  assert.equal(target.roles.highest.position, 80, "the leash marker is actually the target's highest role");
  assert.equal(canApplyDogAction(actor, target, OWNER, "dog-marker"), true);
});

test("missing hierarchy data fails closed and self-targeting is denied", () => {
  assert.equal(canApplyDogAction(member("staff", 10), member("staff", 10), OWNER), false);
  assert.equal(canApplyDogAction({ id: "staff", roles: {} }, member("target", 1), OWNER), false);
});

test("the bot must be strictly above the target to modify it", () => {
  assert.equal(isBotAboveDogTarget(member("bot", 50), member("target", 20)), true);
  assert.equal(isBotAboveDogTarget(member("bot", 20), member("target", 20)), false);
  assert.equal(isBotAboveDogTarget(member("bot", 10), member("target", 20)), false);
  assert.equal(isBotAboveDogTarget({ id: "bot", roles: {} }, member("target", 1)), false);
});


test("only SYS+ or the server owner can release a DOG leash", () => {
  const sysRoleId = "12345678901234567";
  assert.equal(canRemoveDogLeash(member("sysplus", 20, [role(sysRoleId, 20)]), OWNER, sysRoleId), true);
  assert.equal(canRemoveDogLeash(member(OWNER, 0), OWNER, null), true);
  assert.equal(canRemoveDogLeash(member("administrator", 50), OWNER, null), false);
  assert.equal(canRemoveDogLeash(member("staff", 20), OWNER, "other-role"), false);
  assert.equal(canRemoveDogLeash(member("everyone", 0, [role("guild", 0)]), OWNER, "guild"), false);
});
