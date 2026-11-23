import test from "node:test";
import assert from "node:assert/strict";
import {
  applyServerClonePlan,
  authorizeServerClone,
  buildServerClonePlan,
  DISCORD_MAX_CHANNELS,
  sanitizeRolePermissions,
} from "./server-clone.js";

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const SEND_MESSAGES = 1n << 11n;
const VIEW_CHANNEL = 1n << 10n;

function collection(items) {
  const map = new Map(items.map((item) => [item.id, item]));
  return { values: () => map.values(), get: (id) => map.get(id) };
}

function liveGuild({ id = "target-1", roles = [], channels = [] } = {}) {
  return {
    id,
    roles: { cache: collection(roles) },
    channels: { cache: collection(channels) },
  };
}

function snapshot({ guildId = "source-1", roles = [], channels = [] } = {}) {
  return { schemaVersion: 1, guildId, guildName: "Source", capturedAt: 1, roles, channels };
}

const everyoneRole = { id: "source-1", name: "@everyone", permissions: String(VIEW_CHANNEL) };
const staffRole = { id: "r-staff", name: "Staff", color: 0, hoist: true, mentionable: false, permissions: String(SEND_MESSAGES | MANAGE_GUILD | ADMINISTRATOR), position: 2 };
const memberRole = { id: "r-member", name: "Membre", color: 0, hoist: false, mentionable: true, permissions: String(SEND_MESSAGES), position: 1 };

test("permission sanitizer strips privileged bits and keeps ordinary ones", () => {
  const result = sanitizeRolePermissions(String(ADMINISTRATOR | MANAGE_GUILD | SEND_MESSAGES));
  assert.equal(BigInt(result.permissions) & ADMINISTRATOR, 0n);
  assert.equal(BigInt(result.permissions) & MANAGE_GUILD, 0n);
  assert.equal(BigInt(result.permissions) & SEND_MESSAGES, SEND_MESSAGES);
  assert.deepEqual(result.stripped.sort(), ["ADMINISTRATOR", "MANAGE_GUILD"]);
});

test("plan is additive: existing roles and channels are referenced, never recreated", () => {
  const snap = snapshot({
    roles: [everyoneRole, memberRole, staffRole],
    channels: [{ id: "c-general", name: "general", type: 0, position: 0, permissionOverwrites: [] }],
  });
  const guild = liveGuild({
    roles: [{ id: "t-member", name: "Membre", managed: false, position: 1 }],
    channels: [{ id: "t-general", name: "general", type: 0, parentId: null }],
  });
  const plan = buildServerClonePlan({ snapshot: snap, guild });
  assert.deepEqual(plan.roles.map((role) => role.name), ["Staff"]);
  assert.deepEqual(plan.channels, []);
  assert.deepEqual(plan.existingRoleMap, [["r-member", "t-member"]]);
  assert.deepEqual(plan.skippedExistingChannels, ["c-general"]);
});

test("privileged permissions from a foreign blueprint are never planned for creation", () => {
  const snap = snapshot({ guildId: "other-server", roles: [staffRole] });
  const plan = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  assert.equal(plan.roles.length, 1);
  assert.equal(BigInt(plan.roles[0].permissions) & ADMINISTRATOR, 0n);
  assert.deepEqual(plan.stripped, [{ role: "Staff", bits: ["ADMINISTRATOR", "MANAGE_GUILD"] }]);
});

test("source @everyone overwrites are remapped to the target guild and existing roles resolve to target ids", () => {
  const snap = snapshot({
    roles: [everyoneRole, memberRole],
    channels: [{
      id: "c-private", name: "staff-only", type: 0, position: 0,
      permissionOverwrites: [
        { id: "source-1", type: 0, allow: "0", deny: String(VIEW_CHANNEL) },
        { id: "r-member", type: 0, allow: String(SEND_MESSAGES), deny: "0" },
      ],
    }],
  });
  const guild = liveGuild({ roles: [{ id: "t-member", name: "Membre", managed: false, position: 1 }] });
  const plan = buildServerClonePlan({ snapshot: snap, guild });
  assert.equal(plan.channels[0].permissionOverwrites.length, 2);
  assert.equal(plan.sourceGuildId, "source-1");
  assert.equal(plan.targetGuildId, "target-1");
});

test("child channels keep their category, and categories are created first", () => {
  const snap = snapshot({
    channels: [
      { id: "c-child", name: "chat", type: 0, parentId: "c-cat", position: 1, permissionOverwrites: [] },
      { id: "c-cat", name: "Accueil", type: 4, position: 0, permissionOverwrites: [] },
    ],
  });
  const plan = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  assert.deepEqual(plan.channels.map((c) => c.name), ["Accueil", "chat"]);
  assert.deepEqual(plan.channels[1].parentRef, { kind: "create", id: "c-cat" });
});

test("a child whose category cannot be restored is kept top-level with a warning", () => {
  const snap = snapshot({
    channels: [{ id: "c-child", name: "orphan", type: 0, parentId: "missing-cat", position: 0, permissionOverwrites: [] }],
  });
  const plan = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  assert.equal(plan.channels[0].parentRef, null);
  assert.equal(plan.warnings.length, 1);
});

test("plan refuses to exceed Discord's channel limit before creating anything", () => {
  const existing = Array.from({ length: DISCORD_MAX_CHANNELS }, (_, i) => ({ id: `e${i}`, name: `e${i}`, type: 0 }));
  const snap = snapshot({ channels: [{ id: "x", name: "new", type: 0, permissionOverwrites: [] }] });
  assert.throws(() => buildServerClonePlan({ snapshot: snap, guild: liveGuild({ channels: existing }) }), /salons/);
});

test("rejects unsupported snapshot versions", () => {
  assert.throws(() => buildServerClonePlan({ snapshot: { schemaVersion: 2 }, guild: liveGuild() }), /non prise en charge/);
});

test("the token changes when the target server changes, and a stale apply creates nothing", async () => {
  const snap = snapshot({ roles: [memberRole] });
  const before = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  const after = buildServerClonePlan({ snapshot: snap, guild: liveGuild({ roles: [{ id: "x", name: "Autre", managed: false }] }) });
  assert.notEqual(before.token, after.token);

  const calls = [];
  const executor = { createRole: async (d) => (calls.push(d), { id: "new" }), createChannel: async () => ({ id: "c" }) };
  const result = await applyServerClonePlan({ plan: before, token: before.token, rebuilt: after, executor });
  assert.equal(result.code, "PLAN_STALE");
  assert.equal(calls.length, 0);
});

test("applying a fresh plan creates roles then channels and maps parents and overwrites", async () => {
  const snap = snapshot({
    roles: [everyoneRole, memberRole],
    channels: [
      { id: "c-cat", name: "Accueil", type: 4, position: 0, permissionOverwrites: [] },
      {
        id: "c-chat", name: "chat", type: 0, parentId: "c-cat", position: 1,
        permissionOverwrites: [{ id: "r-member", type: 0, allow: String(SEND_MESSAGES), deny: "0" }],
      },
    ],
  });
  const plan = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  const rebuilt = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  const roleCalls = [];
  const channelCalls = [];
  const executor = {
    createRole: async (d) => (roleCalls.push(d), { id: `R${roleCalls.length}` }),
    createChannel: async (d) => (channelCalls.push(d), { id: `C${channelCalls.length}` }),
  };
  const result = await applyServerClonePlan({ plan, token: plan.token, rebuilt, executor });
  assert.equal(result.code, "APPLIED");
  assert.equal(result.createdRoles, 1);
  assert.equal(result.createdChannels, 2);
  assert.equal(channelCalls[1].parent, "C1");
  assert.deepEqual(channelCalls[1].permissionOverwrites, [{ id: "R1", type: 0, allow: String(SEND_MESSAGES), deny: "0" }]);
  assert.equal(roleCalls[0].permissions, String(SEND_MESSAGES));
});

test("partial failures are reported without aborting unrelated creations", async () => {
  const snap = snapshot({ channels: [
    { id: "a", name: "un", type: 0, permissionOverwrites: [] },
    { id: "b", name: "deux", type: 0, permissionOverwrites: [] },
  ] });
  const plan = buildServerClonePlan({ snapshot: snap, guild: liveGuild() });
  let calls = 0;
  const executor = {
    createRole: async () => ({ id: "x" }),
    createChannel: async () => { calls += 1; if (calls === 1) throw new Error("boom"); return { id: "ok" }; },
  };
  const result = await applyServerClonePlan({ plan, token: plan.token, rebuilt: plan, executor });
  assert.equal(result.code, "PARTIAL");
  assert.equal(result.createdChannels, 1);
  assert.equal(result.failures[0].name, "un");
});

test("the circuit breaker stops after five consecutive failures", async () => {
  const channels = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `n${i}`, type: 0, permissionOverwrites: [] }));
  const plan = buildServerClonePlan({ snapshot: snapshot({ channels }), guild: liveGuild() });
  let attempts = 0;
  const executor = { createRole: async () => ({ id: "x" }), createChannel: async () => { attempts += 1; throw new Error("down"); } };
  const result = await applyServerClonePlan({ plan, token: plan.token, rebuilt: plan, executor });
  assert.equal(result.code, "CIRCUIT_OPEN");
  assert.equal(attempts, 5);
});

test("clone authorization requires SYS+, the server.tools entitlement and an explicit confirmation", () => {
  const base = { guildId: "target-1", actorId: "u1", tiers: ["SYS_PLUS"] };
  assert.equal(authorizeServerClone({ ...base, entitlements: [] }).code, "ENTITLEMENT_MISSING");
  const pending = authorizeServerClone({ ...base, entitlements: ["server.tools"] });
  assert.equal(pending.allowed, false, "a pending confirmation must not count as allowed");
  assert.equal(pending.code, "CONFIRMATION_REQUIRED");
  const confirmed = authorizeServerClone({ ...base, entitlements: ["server.tools"], confirmed: true });
  assert.equal(confirmed.allowed, true);
  assert.equal(authorizeServerClone({ guildId: "target-1", actorId: "u1", tiers: ["ADMIN_PLUS"], entitlements: ["server.tools"], confirmed: true }).code, "TIER_INSUFFICIENT");
});
