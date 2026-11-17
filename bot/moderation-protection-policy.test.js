import test from "node:test";
import assert from "node:assert/strict";
import {
  botCanModerate, canUseModeration, getRemovableConfiguredRoleIds, isProtectedMember,
  nextProtectStrike, protectStrikeAction,
} from "./moderation-protection-policy.js";

function member(id, roles = [], position = 1) {
  const roleMap = new Map(roles.map((r) => [r, true]));
  const highest = { position, comparePositionTo(other) { return this.position - other.position; } };
  return { id, roles: { cache: roleMap, highest } };
}

test("only configured staff, SYS+ and owner can moderate", () => {
  assert.equal(canUseModeration(member("staff", ["mod"]), "owner", "sys", ["mod"]), true);
  assert.equal(canUseModeration(member("sys", ["sys"]), "owner", "sys", ["mod"]), true);
  assert.equal(canUseModeration(member("owner"), "owner", "sys", []), true);
  assert.equal(canUseModeration(member("random"), "owner", "sys", ["mod"]), false);
  assert.equal(canUseModeration(member("random"), "owner", null, []), false);
});

test("Protect role, untouchable roles and server owner cannot be sanctioned", () => {
  assert.equal(isProtectedMember(member("p", ["protect"]), "owner", "protect"), true);
  assert.equal(isProtectedMember(member("ow", ["ow"]), "owner", null, ["ow"]), true);
  assert.equal(isProtectedMember(member("owner"), "owner", null), true);
  assert.equal(isProtectedMember(member("normal"), "owner", "protect", ["ow"]), false);
});

test("three attempted sanctions escalate warning, timeout, then derank", () => {
  assert.equal(nextProtectStrike(0), 1);
  assert.equal(protectStrikeAction(1), "warn");
  assert.equal(nextProtectStrike(1), 2);
  assert.equal(protectStrikeAction(2), "timeout");
  assert.equal(nextProtectStrike(2), 3);
  assert.equal(protectStrikeAction(3), "derank");
  assert.equal(nextProtectStrike(3), 3);
});

test("actor and bot must both be strictly above target", () => {
  assert.equal(botCanModerate(member("bot", [], 10), member("target", [], 5)), true);
  assert.equal(botCanModerate(member("bot", [], 5), member("target", [], 5)), false);
  assert.equal(botCanModerate(member("bot", [], 4), member("target", [], 5)), false);
});


test("third-strike derank includes only unmanaged configured roles below the bot", () => {
  const role = (id, position, managed = false) => ({
    id, managed, position,
    comparePositionTo(other) { return this.position - other.position; },
  });
  const memberRoles = new Map([
    ["staff", role("staff", 3)],
    ["sys", role("sys", 5)],
    ["managed", role("managed", 2, true)],
    ["above-bot", role("above-bot", 12)],
  ]);
  const actor = { guild: { id: "guild" }, roles: { cache: memberRoles } };
  const botHighest = role("bot-highest", 10);
  const bot = { roles: { highest: botHighest } };
  assert.deepEqual(getRemovableConfiguredRoleIds(actor, bot, ["staff", "sys", "managed", "above-bot", "missing"]), ["staff", "sys"]);
  assert.deepEqual(getRemovableConfiguredRoleIds(actor, bot, ["above-bot"]), []);
});
