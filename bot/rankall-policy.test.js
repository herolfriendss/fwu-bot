import test from "node:test";
import assert from "node:assert/strict";
import { isConfiguredBotOwner, planRankAll } from "./rankall-policy.js";

test("rankall is restricted to explicitly configured bot owners", () => {
  assert.equal(isConfiguredBotOwner("owner-1", ["owner-1", "owner-2"]), true);
  assert.equal(isConfiguredBotOwner("guild-owner", ["owner-1", "owner-2"]), false);
  assert.equal(isConfiguredBotOwner("owner-1", []), false);
});

test("rankall plan excludes existing role holders and hierarchy-protected members", () => {
  const actor = { id: "actor", roles: { highest: { position: 8 } } };
  const botMember = { id: "bot", roles: { highest: { position: 10 } } };
  const role = { id: "role", position: 4, managed: false };
  const member = (id, position, hasRole = false) => ({ id, roles: { highest: { position }, cache: { has: (id) => hasRole && id === role.id } } });
  const members = [member("eligible", 2), member("already", 1, true), member("higher", 9), member("guild-owner", 0)];
  const result = planRankAll({ members, role, guild: { id: "guild", ownerId: "guild-owner" }, actor, botMember });
  assert.deepEqual(result.eligible.map((item) => item.id), ["eligible"]);
  assert.deepEqual(result.skipped.map((item) => item.id), ["higher", "guild-owner"]);
});
