import test from "node:test";
import assert from "node:assert/strict";
import { canProtectNickname, protectedNicknameRestore } from "./policy.js";

const valid = {
  actorId: "11111",
  ownerId: "99999",
  targetId: "22222",
  actorRolePosition: 10,
  targetRolePosition: 3,
  botRolePosition: 20,
  actorCanManageNicknames: true,
  botCanManageNicknames: true,
  privileged: true,
};

test("nickname protection requires a privileged operator and Discord permissions", () => {
  assert.equal(canProtectNickname(valid), true);
  assert.equal(canProtectNickname({ ...valid, privileged: false }), false);
  assert.equal(canProtectNickname({ ...valid, actorCanManageNicknames: false }), false);
  assert.equal(canProtectNickname({ ...valid, botCanManageNicknames: false }), false);
});

test("nickname protection respects owner and both role hierarchies", () => {
  assert.equal(canProtectNickname({ ...valid, targetIsOwner: true }), false);
  assert.equal(canProtectNickname({ ...valid, actorId: valid.ownerId, actorIsGuildOwner: true }), true);
  assert.equal(canProtectNickname({ ...valid, actorId: valid.targetId }), false);
  assert.equal(canProtectNickname({ ...valid, targetRolePosition: 10 }), false);
  assert.equal(canProtectNickname({ ...valid, targetRolePosition: 20 }), false);
});

test("restore policy keeps null as the original Discord nickname and ignores unchanged names", () => {
  assert.deepEqual(protectedNicknameRestore("Current", "Original"), { shouldRestore: true, nickname: "Original" });
  assert.deepEqual(protectedNicknameRestore("Current", null), { shouldRestore: true, nickname: null });
  assert.deepEqual(protectedNicknameRestore(null, null), { shouldRestore: false, nickname: null });
  assert.deepEqual(protectedNicknameRestore("Same", "Same"), { shouldRestore: false, nickname: "Same" });
});
