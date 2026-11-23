import test from "node:test";
import assert from "node:assert/strict";
import { handleGuildGuardJoin, resetGuildGuardState } from "./guild-guard.js";
import { evaluateJoin, isQuarantineRoleAssignable } from "./guild-guard-policy.js";

const guard = {
  enabled: true,
  minAccountAgeDays: 30,
  youngAccountAction: "quarantine",
  quarantineRoleId: "quarantine-role",
  raidJoinThreshold: 0,
};

function makeMember({ rolePosition = 2, manageRoles = true, addFails = false } = {}) {
  let addCount = 0;
  const role = { id: "quarantine-role", managed: false, position: rolePosition };
  const bot = {
    roles: { highest: { position: 5 } },
    permissions: { has: () => manageRoles },
  };
  const guild = {
    id: `guild-${Math.random()}`,
    name: "Test Guild",
    roles: { fetch: async () => role },
    members: { fetchMe: async () => bot },
  };
  const member = {
    id: "new-member",
    guild,
    user: { bot: false, tag: "new-member#0001", createdAt: new Date() },
    roles: {
      add: async () => {
        addCount++;
        if (addFails) throw new Error("discord add failed");
      },
    },
  };
  return {
    member,
    get addCount() {
      return addCount;
    },
  };
}

test("quarantine role checks include bot permission and live role hierarchy", () => {
  const role = { id: "role", managed: false, position: 2 };
  assert.equal(isQuarantineRoleAssignable(role, "guild", 3, true), true);
  assert.equal(isQuarantineRoleAssignable(role, "guild", 3, false), false);
  assert.equal(isQuarantineRoleAssignable({ ...role, position: 3 }, "guild", 3, true), false);
  assert.equal(isQuarantineRoleAssignable({ ...role, managed: true }, "guild", 3, true), false);
  assert.equal(isQuarantineRoleAssignable({ ...role, id: "guild" }, "guild", 3, true), false);
});

test("raid bursts never kick established accounts solely due to join volume", () => {
  const now = Date.now();
  const kickGuard = { ...guard, youngAccountAction: "kick", minAccountAgeDays: 30 };
  const established = evaluateJoin({ createdAt: new Date(now - 365 * 86_400_000), now, guard: kickGuard, raidMode: true });
  const newAccount = evaluateJoin({ createdAt: new Date(now - 86_400_000), now, guard: kickGuard, raidMode: true });
  const unrestrictedAge = evaluateJoin({ createdAt: new Date(now), now, guard: { ...kickGuard, minAccountAgeDays: 0 }, raidMode: true });
  const lockdown = evaluateJoin({ createdAt: new Date(now - 365 * 86_400_000), now, guard: { ...kickGuard, lockdown: true }, raidMode: true });

  assert.deepEqual(established, { action: "allow", reason: null });
  assert.deepEqual(newAccount, { action: "kick", reason: "raid" });
  assert.deepEqual(unrestrictedAge, { action: "allow", reason: null });
  assert.deepEqual(lockdown, { action: "kick", reason: "lockdown" });
});

test("GuildGuard reports quarantine only after Discord accepts the role", async () => {
  resetGuildGuardState();
  const denied = makeMember({ manageRoles: false });
  const deniedEvents = [];
  assert.equal(
    await handleGuildGuardJoin(denied.member, guard, (code) => deniedEvents.push(code)),
    false,
  );
  assert.equal(denied.addCount, 0);
  assert.ok(deniedEvents.includes("guild_guard_error"));
  assert.ok(!deniedEvents.includes("guild_guard_quarantine"));

  resetGuildGuardState();
  const accepted = makeMember();
  const acceptedEvents = [];
  assert.equal(
    await handleGuildGuardJoin(accepted.member, guard, (code) => acceptedEvents.push(code)),
    true,
  );
  assert.equal(accepted.addCount, 1);
  assert.ok(acceptedEvents.includes("guild_guard_quarantine"));
  assert.ok(!acceptedEvents.includes("guild_guard_error"));
});

test("GuildGuard falls back to a logged result when Discord rejects role assignment", async () => {
  resetGuildGuardState();
  const denied = makeMember({ addFails: true });
  const events = [];
  assert.equal(
    await handleGuildGuardJoin(denied.member, guard, (code) => events.push(code)),
    false,
  );
  assert.equal(denied.addCount, 1);
  assert.ok(events.includes("guild_guard_error"));
  assert.ok(!events.includes("guild_guard_quarantine"));
});
