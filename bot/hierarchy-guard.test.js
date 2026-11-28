import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { HIERARCHY_MESSAGES, HIERARCHY_TARGETS, checkInteractionHierarchy, decideHierarchy } from "./hierarchy-guard.js";
import { canModerate } from "./moderation-policy.js";
import { roleAssignmentDecision } from "./role-policy.js";
import { evaluateTargetHierarchy } from "./target-hierarchy-policy.js";

const OWNER = "100000000000000001";
const GUILD_OWNER = "100000000000000009";
const base = { guildOwnerId: GUILD_OWNER, pndOwnerId: OWNER };

test("staff can only target members strictly below them", () => {
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: "3", actorPosition: 10, targetPosition: 5 }), null);
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: "3", actorPosition: 10, targetPosition: 10 }), HIERARCHY_MESSAGES.notLower);
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: "3", actorPosition: 10, targetPosition: 20 }), HIERARCHY_MESSAGES.notLower);
});

test("the OWNER has full access and nobody else can target the OWNER", () => {
  assert.equal(decideHierarchy({ ...base, actorId: OWNER, targetId: "3", actorPosition: 1, targetPosition: 99 }), null);
  assert.equal(decideHierarchy({ ...base, actorId: OWNER, targetId: GUILD_OWNER, actorPosition: 1, targetPosition: 99 }), null);
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: OWNER, actorPosition: 99, targetPosition: 1 }), HIERARCHY_MESSAGES.owner);
  assert.equal(decideHierarchy({ ...base, actorId: GUILD_OWNER, targetId: OWNER, actorPosition: 99, targetPosition: 1 }), HIERARCHY_MESSAGES.owner);
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: GUILD_OWNER, actorPosition: 99, targetPosition: 1 }), HIERARCHY_MESSAGES.guildOwner);
});

test("non-members (ban by ID) and self-targeting are left to the command", () => {
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: "3", actorPosition: 10, targetPosition: null }), null);
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: "2", actorPosition: 10, targetPosition: 10 }), null);
  assert.equal(decideHierarchy({ ...base, actorId: "2", targetId: "3", actorPosition: Number.NaN, targetPosition: 4 }), HIERARCHY_MESSAGES.unreadable);
});

function interaction({ path, actorId, targetId, positions, guildOwnerId = GUILD_OWNER, failure = null }) {
  const [commandName, a, b] = path.split(" ");
  const sub = b ?? a ?? null;
  const group = b ? a : null;
  return {
    commandName,
    isChatInputCommand: () => true,
    user: { id: actorId },
    options: { getSubcommand: () => sub, getSubcommandGroup: () => group, getUser: () => ({ id: targetId }) },
    guild: {
      ownerId: guildOwnerId,
      members: {
        fetch: async ({ user }) => {
          if (failure && user === targetId) throw failure;
          if (user in positions) return { id: user, roles: { highest: { position: positions[user] } } };
          throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        },
      },
    },
  };
}

test("central guard refuses a SYS+ action on a higher member and lets the OWNER through", async () => {
  const positions = { 2: 10, 3: 20, [OWNER]: 1 };
  assert.equal(await checkInteractionHierarchy(interaction({ path: "sysp whitelist whitelist-add", actorId: "2", targetId: "3", positions }), { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.notLower);
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "2", targetId: "3", positions }), { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.notLower);
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: OWNER, targetId: "3", positions }), { pndOwnerId: OWNER }), null);
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "3", targetId: "2", positions }), { pndOwnerId: OWNER }), null);
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "3", targetId: "404", positions }), { pndOwnerId: OWNER }), null, "ban by ID of a non-member");
  assert.equal(await checkInteractionHierarchy(interaction({ path: "balance", actorId: "2", targetId: "3", positions }), { pndOwnerId: OWNER }), null, "public commands untouched");
});

test("central guard fails closed when the target cannot be read, but allows a target absent from the server", async () => {
  const positions = { 2: 10, 3: 5 };
  const rateLimited = Object.assign(new Error("rate limited"), { status: 429 });
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "2", targetId: "3", positions, failure: rateLimited }), { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.unreadable, "rate limit → refused");
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "2", targetId: "3", positions, failure: new Error("network down") }), { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.unreadable, "generic error → refused");
  const unknownUser = Object.assign(new Error("Unknown User"), { code: 10013 });
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "2", targetId: "3", positions, failure: unknownUser }), { pndOwnerId: OWNER }), null, "unknown user → absent, allowed");
  assert.equal(await checkInteractionHierarchy(interaction({ path: "ban", actorId: "2", targetId: "404", positions }), { pndOwnerId: OWNER }), null, "unknown member (10007) → absent, allowed");
});


test("only ban and blacklist-add may target a confirmed non-member", async () => {
  const positions = { 2: 10 };
  const dogMissing = interaction({ path: "dog", actorId: "2", targetId: "404", positions });
  const blacklistMissing = interaction({ path: "blacklist add", actorId: "2", targetId: "404", positions });
  const rankMissing = interaction({ path: "rank", actorId: "2", targetId: "404", positions });
  assert.equal(await checkInteractionHierarchy(dogMissing, { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.targetMissing);
  assert.equal(await checkInteractionHierarchy(rankMissing, { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.targetMissing);
  assert.equal(await checkInteractionHierarchy(blacklistMissing, { pndOwnerId: OWNER }), null);
});

test("decideHierarchy refuses an unreadable target marker", () => {
  assert.equal(decideHierarchy({ actorId: "2", targetId: "3", actorPosition: 10, targetPosition: Number.NaN, guildOwnerId: GUILD_OWNER, pndOwnerId: OWNER }), HIERARCHY_MESSAGES.unreadable);
});

test("every targeted path exists in the slash catalogue with that member option", async () => {
  const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");
  const paths = new Map();
  const walk = (node, path) => {
    for (const o of node.options ?? []) {
      if (o.type === 1 || o.type === 2) walk(o, [...path, o.name]);
      else if (o.type === 6) paths.set(`${path.join(" ")}|${o.name}`, true);
    }
  };
  for (const c of [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS]) walk(c, [c.name]);
  for (const [path, option] of Object.entries(HIERARCHY_TARGETS)) assert.ok(paths.has(`${path}|${option}`), `${path} (${option})`);
});

test("module policies also give the OWNER full access", () => {
  assert.equal(canModerate({ actorId: OWNER, targetId: "3", guildOwnerId: GUILD_OWNER, pndOwnerId: OWNER, actorPermissions: "0", targetPermissions: "8", actorPosition: 1, targetPosition: 50, botPosition: 99, requiredBit: "4" }).allowed, true);
  assert.equal(canModerate({ actorId: "2", targetId: "3", guildOwnerId: GUILD_OWNER, pndOwnerId: OWNER, actorPermissions: "4", actorPosition: 10, targetPosition: 50, botPosition: 99, requiredBit: "4" }).allowed, false);
  assert.equal(canModerate({ actorId: "2", targetId: OWNER, guildOwnerId: GUILD_OWNER, pndOwnerId: OWNER, actorPermissions: "8", actorPosition: 90, targetPosition: 1, botPosition: 99, requiredBit: "4" }).allowed, false);
  const role = { targetId: "3", roleId: "77", everyoneRoleId: "0", roleManaged: false, botId: "999", botPosition: 99, ownerId: GUILD_OWNER, pndOwnerId: OWNER };
  assert.equal(roleAssignmentDecision({ ...role, actorId: OWNER, actorPosition: 1, targetPosition: 50, rolePosition: 60 }).allowed, true);
  assert.equal(roleAssignmentDecision({ ...role, actorId: "2", actorPosition: 10, targetPosition: 5, rolePosition: 60 }).allowed, false);
  const bot = { id: "999", roles: { highest: { position: 99 } } };
  assert.equal(evaluateTargetHierarchy({ actor: { id: OWNER, roles: { highest: { position: 1 } } }, target: { id: "3", roles: { highest: { position: 50 } } }, bot, guildOwnerId: GUILD_OWNER, pndOwnerId: OWNER }).allowed, true);
});

test("the guard runs in interactionCreate before any command handler", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const guard = source.indexOf("checkInteractionHierarchy(interaction)");
  assert.ok(guard > 0);
  assert.ok(guard < source.indexOf("handleDmAllInteraction(interaction"), "guard before handlers");
});

test("prefix commands map to the same targeted paths as their slash form", async () => {
  const { prefixHierarchyPath, prefixTargetId } = await import("./hierarchy-guard.js");
  assert.equal(prefixHierarchyPath("=rank <@300000000000000003> <@&1>"), "rank");
  assert.equal(prefixHierarchyPath("=dog <@300000000000000003>"), "dog");
  assert.equal(prefixHierarchyPath("=wakeup <@300000000000000003>"), "wakeup");
  assert.equal(prefixHierarchyPath("=lockname <@300000000000000003> Pseudo"), "lockname proteger");
  assert.equal(prefixHierarchyPath("=sysp add <@300000000000000003>"), "sysp add");
  assert.equal(prefixHierarchyPath("=sysp audit <@300000000000000003>"), null, "read-only subcommand untouched");
  assert.equal(prefixHierarchyPath("=balance <@300000000000000003>"), null);
  assert.equal(prefixTargetId("=rank <@!300000000000000003> <@&400000000000000004>"), "300000000000000003");
  assert.equal(prefixTargetId("=ban 300000000000000003 spam"), "300000000000000003");
  assert.equal(prefixTargetId("=rank <@&400000000000000004>"), null);
});

test("prefix hierarchy refuses a higher target and fails closed on read errors", async () => {
  const { checkPrefixHierarchy } = await import("./hierarchy-guard.js");
  const message = (failure = null) => ({
    author: { id: "200000000000000002" },
    guild: {
      ownerId: GUILD_OWNER,
      members: {
        fetch: async ({ user }) => {
          if (failure && user === "300000000000000003") throw failure;
          const positions = { "200000000000000002": 10, "300000000000000003": 20 };
          if (user in positions) return { id: user, roles: { highest: { position: positions[user] } } };
          throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        },
      },
    },
  });
  assert.equal(await checkPrefixHierarchy(message(), "=dog <@300000000000000003>", { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.notLower);
  assert.equal(await checkPrefixHierarchy(message(Object.assign(new Error("x"), { status: 429 })), "=wakeup <@300000000000000003>", { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.unreadable);
  assert.equal(await checkPrefixHierarchy(message(), "=balance <@300000000000000003>", { pndOwnerId: OWNER }), null);
  assert.equal(await checkPrefixHierarchy(message(), "=ban 999999999999999999", { pndOwnerId: OWNER }), null, "absent → allowed (ban by ID)");
  assert.equal(await checkPrefixHierarchy(message(), "=dog 999999999999999999", { pndOwnerId: OWNER }), HIERARCHY_MESSAGES.targetMissing, "absent → refused for member-only action");
});
