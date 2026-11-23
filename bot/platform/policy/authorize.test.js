import test from "node:test";
import assert from "node:assert/strict";
import { authorize, AI_FORBIDDEN_ACTIONS } from "./authorize.js";

const base = (overrides = {}) => ({
  guildId: "guild-a",
  actor: { id: "actor-a" },
  actionPolicy: { key: "tickets.close", minTiers: ["MEMBER"] },
  resolved: {
    guildId: "guild-a",
    guildStatus: "active",
    moduleEnabled: true,
    tiers: ["MEMBER"],
    permissions: [],
    botPermissions: [],
    adminScopes: [],
    entitlements: [],
    quotaExceeded: false,
    whitelist: false,
  },
  ...overrides,
});

test("authorizes an active guild member for a CORE action", () => {
  assert.equal(authorize(base()).code, "AUTHORIZED");
});

test("fails closed for missing context or a mismatched guild", () => {
  assert.equal(authorize({}).code, "INVALID_CONTEXT");
  assert.equal(authorize(base({ resolved: { ...base().resolved, guildId: "guild-b" } })).code, "GUILD_MISMATCH");
});

test("disabled and unknown guilds are denied", () => {
  assert.equal(authorize(base({ resolved: { ...base().resolved, guildStatus: "disabled" } })).code, "GUILD_NOT_AUTHORIZED");
  assert.equal(authorize(base({ resolved: { ...base().resolved, guildStatus: "pending" } })).code, "GUILD_NOT_AUTHORIZED");
});

test("disabled modules and missing entitlements are denied", () => {
  assert.equal(authorize(base({ resolved: { ...base().resolved, moduleEnabled: false } })).code, "MODULE_DISABLED");
  assert.equal(authorize(base({ actionPolicy: { key: "analytics.advanced", entitlement: "analytics.advanced" } })).code, "ENTITLEMENT_MISSING");
});

test("SYS+ does not grant a scope that is explicitly required", () => {
  const input = base({
    actionPolicy: { key: "economy.audit", minTiers: ["SYS_PLUS", "GUILD_OWNER"], scope: "economy.audit" },
    resolved: { ...base().resolved, tiers: ["SYS_PLUS"] },
  });
  assert.equal(authorize(input).code, "SCOPE_DENIED");
});

test("an explicitly configured higher tier may bypass a scope", () => {
  const input = base({
    actionPolicy: { key: "staff.configure", minTiers: ["GUILD_OWNER"], scope: "staff.configure", allowScopeBypassTiers: ["GUILD_OWNER"] },
    resolved: { ...base().resolved, tiers: ["GUILD_OWNER"] },
  });
  assert.equal(authorize(input).code, "AUTHORIZED");
});

test("native actor and bot permissions are checked independently", () => {
  const policy = { key: "moderation.warn", minTiers: ["STAFF"], requiredPermissions: ["ModerateMembers"], botRequiredPermissions: ["ModerateMembers"] };
  const baseResolved = { ...base().resolved, tiers: ["STAFF"] };
  assert.equal(authorize(base({ actionPolicy: policy, resolved: baseResolved })).code, "DISCORD_PERMISSION");
  assert.equal(authorize(base({ actionPolicy: policy, resolved: { ...baseResolved, permissions: ["ModerateMembers"] } })).code, "BOT_PERMISSION");
  assert.equal(authorize(base({ actionPolicy: policy, resolved: { ...baseResolved, permissions: ["ModerateMembers"], botPermissions: ["ModerateMembers"] } })).code, "AUTHORIZED");
});

test("role hierarchy requires both actor and bot above target", () => {
  const policy = { key: "moderation.kick", minTiers: ["STAFF"], requireHierarchy: true };
  const resolved = { ...base().resolved, tiers: ["STAFF"], actorRolePosition: 10, targetRolePosition: 5, botRolePosition: 8 };
  assert.equal(authorize(base({ actionPolicy: policy, resolved })).code, "AUTHORIZED");
  assert.equal(authorize(base({ actionPolicy: policy, resolved: { ...resolved, botRolePosition: 4 } })).code, "HIERARCHY");
  assert.equal(authorize(base({ actionPolicy: policy, resolved: { ...resolved, actorRolePosition: 5 } })).code, "HIERARCHY");
});

test("WHITELIST bypasses only internal quotas", () => {
  const policy = { key: "games.create", minTiers: ["SYS_PLUS"] };
  const baseResolved = { ...base().resolved, tiers: ["MEMBER"], quotaExceeded: true, whitelist: true };
  assert.equal(authorize(base({ actionPolicy: policy, resolved: baseResolved })).code, "TIER_INSUFFICIENT");
  assert.equal(authorize(base({ actionPolicy: { key: "games.play", minTiers: ["MEMBER"] }, resolved: baseResolved })).code, "AUTHORIZED");
  assert.equal(authorize(base({ actionPolicy: { key: "games.play", minTiers: ["MEMBER"] }, resolved: { ...baseResolved, whitelist: false } })).code, "LIMIT_REACHED");
});

test("sensitive actions are allowed only with an explicit confirmation step", () => {
  const input = base({ actionPolicy: { key: "server.lockdown", minTiers: ["SYS_PLUS"], sensitive: true }, resolved: { ...base().resolved, tiers: ["SYS_PLUS"] } });
  const pending = authorize(input);
  assert.equal(pending.allow, true);
  assert.equal(pending.needsConfirmation, true);
  assert.equal(pending.code, "CONFIRMATION_REQUIRED");
  assert.equal(authorize({ ...input, confirmed: true }).needsConfirmation, false);
});

test("AI actions require allowlisting, valid delegation and delegated authorization", () => {
  const policy = { key: "events.create", aiTools: ["events.create"] };
  const resolved = { ...base().resolved, tiers: ["MEMBER"], resolvedUserId: "user-a", delegatedUserAuthorized: true };
  const actor = { id: "agent", kind: "ai", onBehalfOf: "user-a" };
  assert.equal(authorize(base({ actor, actionPolicy: policy, resolved })).code, "AUTHORIZED");
  assert.equal(authorize(base({ actor, actionPolicy: { ...policy, aiTools: [] }, resolved })).code, "AI_TOOL_NOT_ALLOWED");
  assert.equal(authorize(base({ actor, actionPolicy: policy, resolved: { ...resolved, delegatedUserAuthorized: false } })).code, "AI_DELEGATED_USER_DENIED");
});

test("AI forbidden actions cannot be enabled by an allowlist", () => {
  for (const key of AI_FORBIDDEN_ACTIONS) {
    const input = base({
      actor: { id: "agent", kind: "ai", onBehalfOf: "user-a" },
      actionPolicy: { key, aiTools: [key] },
      resolved: { ...base().resolved, resolvedUserId: "user-a", delegatedUserAuthorized: true },
    });
    assert.equal(authorize(input).code, "AI_ACTION_FORBIDDEN", key);
  }
});


test("explicit capabilities can preserve existing GuildGuard configuration access", () => {
  const policy = { key: "guardian.configure", requiredCapabilities: ["guildguard.manage"] };
  assert.equal(authorize(base({ actionPolicy: policy })).code, "CAPABILITY_DENIED");
  assert.equal(authorize(base({ actionPolicy: policy, resolved: { ...base().resolved, capabilities: ["guildguard.manage"] } })).code, "AUTHORIZED");
});
