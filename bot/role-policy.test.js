import test from "node:test";
import assert from "node:assert/strict";
import { roleAssignmentDecision } from "./role-policy.js";

const base = {
  actorId: "10", ownerId: "1", targetId: "20", actorPosition: 5,
  targetPosition: 2, roleId: "30", everyoneRoleId: "1", rolePosition: 1,
  roleManaged: false, botId: "99", botPosition: 10,
};

test("ADMIN+/SYS+ can assign a role below their hierarchy and the bot", () => {
  assert.equal(roleAssignmentDecision(base).allowed, true);
});
test("cannot assign managed or everyone roles", () => {
  assert.equal(roleAssignmentDecision({ ...base, roleManaged: true }).allowed, false);
  assert.equal(roleAssignmentDecision({ ...base, roleId: "1" }).allowed, false);
});
test("cannot modify members at or above actor hierarchy", () => {
  assert.equal(roleAssignmentDecision({ ...base, targetPosition: 5 }).allowed, false);
});
test("cannot manage a role at or above actor or bot", () => {
  assert.equal(roleAssignmentDecision({ ...base, rolePosition: 5 }).allowed, false);
  assert.equal(roleAssignmentDecision({ ...base, rolePosition: 10 }).allowed, false);
});
test("server owner can bypass actor hierarchy but never bot hierarchy", () => {
  assert.equal(roleAssignmentDecision({ ...base, actorId: "1", actorPosition: 0, rolePosition: 8 }).allowed, true);
  assert.equal(roleAssignmentDecision({ ...base, actorId: "1", rolePosition: 10 }).allowed, false);
});
test("cannot target server owner or bot", () => {
  assert.equal(roleAssignmentDecision({ ...base, targetId: "1" }).allowed, false);
  assert.equal(roleAssignmentDecision({ ...base, targetId: "99" }).allowed, false);
});
