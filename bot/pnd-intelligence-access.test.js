import test from "node:test";
import assert from "node:assert/strict";
import { canUsePndIntelligence } from "./pnd-intelligence-access.js";

const base = {
  guildId: "555555555555555555",
  channelId: "666666666666666666",
  enabled: true,
  configuredChannelId: "666666666666666666",
  sysPlusRoleId: "777777777777777777",
  ownerIds: ["111111111111111111"],
};

function member(id, roles = []) {
  return { id, guild: { id: base.guildId, ownerId: "888888888888888888" }, roles: { cache: new Map(roles.map((role) => [role, true])) }, permissions: { has: () => false } };
}

test("PND Intelligence is disabled until a dedicated channel is enabled", () => {
  assert.equal(canUsePndIntelligence({ ...base, enabled: false, member: member("111111111111111111") }), false);
  assert.equal(canUsePndIntelligence({ ...base, channelId: "999999999999999999", member: member("111111111111111111") }), false);
  assert.equal(canUsePndIntelligence({ ...base, configuredChannelId: null, member: member("111111111111111111") }), false);
});

test("only configured SYS+ role holders or the single configured PND owner can use it", () => {
  assert.equal(canUsePndIntelligence({ ...base, member: member("333333333333333333", [base.sysPlusRoleId]) }), true);
  assert.equal(canUsePndIntelligence({ ...base, member: member("111111111111111111") }), true);
  assert.equal(canUsePndIntelligence({ ...base, member: member("222222222222222222") }), false);
  assert.equal(canUsePndIntelligence({ ...base, member: member("444444444444444444") }), false);
  assert.equal(canUsePndIntelligence({ ...base, ownerIds: ["111111111111111111", "222222222222222222"], member: member("111111111111111111") }), false);
});
