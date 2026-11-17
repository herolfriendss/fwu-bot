import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { canUseRank, rankAssignmentError } from "./rank-policy.js";

function role(id, position, { managed = false } = {}) {
  return {
    id, position, managed, guild: { id: "guild" },
    comparePositionTo(other) { return this.position - other.position; },
  };
}
function member(id, position, { roles = [], admin = false, ownerId = "owner" } = {}) {
  const everyone = role("guild", 0);
  const all = [everyone, role(`member-role-${id}`, position), ...roles];
  const highest = all.reduce((a, b) => a.comparePositionTo(b) >= 0 ? a : b);
  return {
    id, guild: { id: "guild", ownerId },
    permissions: { has: (flag) => admin && flag === PermissionFlagsBits.Administrator },
    roles: { highest, cache: new Map(all.map((r) => [r.id, r])) },
  };
}

test("only SYS+, administrators and the server owner can use rank", () => {
  assert.equal(canUseRank(member("sys", 5, { roles: [role("sys-role", 5)] }), "owner", "sys-role"), true);
  assert.equal(canUseRank(member("admin", 5, { admin: true }), "owner", "sys-role"), true);
  assert.equal(canUseRank(member("owner", 0), "owner", null), true);
  assert.equal(canUseRank(member("member", 5), "owner", "sys-role"), false);
  assert.equal(canUseRank(null, "owner", "sys-role"), false);
});

test("SYS+ can assign any normal role below the bot to a manageable member", () => {
  const target = member("target", 10);
  const assignedRole = role("rank-role", 20);
  const bot = member("bot", 50);
  assert.equal(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target, role: assignedRole, botMember: bot }), null);
});

test("rank rejects @everyone, managed roles and the server owner", () => {
  const target = member("target", 10);
  const bot = member("bot", 50);
  assert.match(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target, role: role("guild", 0), botMember: bot }), /@everyone/);
  assert.match(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target, role: role("managed", 10, { managed: true }), botMember: bot }), /gérés/);
  assert.match(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target: member("owner", 10), role: role("rank-role", 20), botMember: bot }), /propriétaire/);
});

test("rank rejects roles at or above the bot's highest role", () => {
  const target = member("target", 10);
  const bot = member("bot", 50);
  assert.match(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target, role: role("too-high", 50), botMember: bot }), /strictement sous/);
});

test("rank rejects targets at or above the bot's highest role", () => {
  const target = member("target", 50);
  const bot = member("bot", 50);
  assert.match(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target, role: role("normal", 20), botMember: bot }), /supérieur à celui du membre/);
});

test("rank requires the bot to have Manage Roles", () => {
  const target = member("target", 10);
  const bot = member("bot", 50);
  bot.permissions.has = () => false;
  assert.match(rankAssignmentError({ guildId: "guild", guildOwnerId: "owner", target, role: role("normal", 20), botMember: bot }), /Gérer les rôles/);
});
