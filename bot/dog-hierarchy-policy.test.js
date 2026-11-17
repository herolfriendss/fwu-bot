import test from "node:test";
import assert from "node:assert/strict";
import { canApplyDogAction, isBotAboveDogTarget } from "./dog-hierarchy-policy.js";

function member(id, position, compareOffset = 0) {
  return {
    id,
    roles: {
      highest: {
        position,
        comparePositionTo(other) {
          if (this.position === other.position) return compareOffset;
          return this.position - other.position;
        },
      },
    },
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
