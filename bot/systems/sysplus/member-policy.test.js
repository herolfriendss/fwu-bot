import test from "node:test";
import assert from "node:assert/strict";
import { sysMemberActionDecision } from "./member-policy.js";

const valid = {
  actorId: "owner",
  ownerId: "owner",
  targetId: "member",
  actorPosition: 10,
  targetPosition: 1,
  roleId: "sys-role",
  everyoneRoleId: "guild",
  rolePosition: 2,
  roleManaged: false,
  botId: "bot",
  botPosition: 8,
  hasManageRoles: true,
};

test("SYS+ membership changes are owner-only and require native bot role permission", () => {
  assert.equal(sysMemberActionDecision({ ...valid, actorId: "admin" }).allowed, false);
  assert.match(
    sysMemberActionDecision({ ...valid, hasManageRoles: false }).reason,
    /Gérer les rôles/,
  );
  assert.equal(sysMemberActionDecision(valid).allowed, true);
});

test("SYS+ membership changes respect target and role hierarchy", () => {
  assert.match(sysMemberActionDecision({ ...valid, targetId: "bot" }).reason, /bot/);
  assert.match(sysMemberActionDecision({ ...valid, rolePosition: 8 }).reason, /au-dessus|niveau/);
  assert.match(sysMemberActionDecision({ ...valid, targetId: "owner" }).reason, /propriétaire/);
});
