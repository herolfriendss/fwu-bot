import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-dog-quota-"));
const statePath = join(directory, "dog-state.json");
process.env.PND_DOG_STATE_PATH = statePath;
process.env.HER_DB_PATH = join(directory, "economy.sqlite");

// Each guild has its own SYS+ owner and its own already-active leashes.
// guild-a / owner-a : 3 leashes (default limit reached)
// guild-c / owner-c : 3 leashes (used to check the default limit)
// guild-d / owner-d : 3 leashes (used to check a configured limit)
// guild-e / owner-w : 5 leashes, WHITELIST owner (used to check the exception)
function seed(guildId, ownerId, count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const memberId = `${guildId}-seed-${index + 1}`;
      return [
        `${guildId}:${memberId}`,
        {
          guildId,
          memberId,
          ownerId,
          ownerName: `Owner ${guildId}`,
          since: Date.now() - index * 1000,
          previousNickname: null,
          leashRoleId: "leash-role",
        },
      ];
    }),
  );
}
writeFileSync(
  statePath,
  JSON.stringify({
    ...seed("guild-a", "owner-a", 3),
    ...seed("guild-c", "owner-c", 3),
    ...seed("guild-d", "owner-d", 3),
    ...seed("guild-e", "owner-w", 5),
  }),
);

const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.PND_DOG_STATE_PATH;
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const SYS_PLUS_ROLE = "sysplus-role";
const WHITELIST_ROLE = "whitelist-role";

// Runs `/dog` for one target inside one guild, with the guild's own settings,
// exactly as index.js passes settings[interaction.guildId] to the router.
async function runDog({ guildId, ownerId, whitelisted = false, settings, targetId }) {
  const roleItems = [];
  const leashRole = { id: `${guildId}-leash`, name: "En laisse", managed: false, position: 2 };
  const roleCache = {
    find: (predicate) => roleItems.find(predicate),
    get: (id) => roleItems.find((item) => item.id === id),
  };
  const botMember = {
    permissions: { has: () => true },
    roles: { highest: { position: 10 } },
  };

  const members = new Map();
  const guild = {
    id: guildId,
    name: guildId,
    ownerId: "guild-owner",
    members: {
      cache: { get: (id) => members.get(id) ?? null },
      fetchMe: async () => botMember,
      fetch: async (id) => members.get(typeof id === "string" ? id : id.user) ?? null,
    },
    roles: {
      cache: roleCache,
      create: async () => {
        roleItems.push(leashRole);
        return leashRole;
      },
    },
  };

  const makeMember = (id, roleIds, position = 1) => {
    const memberRoles = new Set(roleIds);
    const member = {
      id,
      guild,
      user: { id, username: id, tag: `${id}#0001` },
      displayName: id,
      nickname: null,
      permissions: { has: () => false },
      roles: {
        highest: { position },
        cache: { has: (roleId) => memberRoles.has(roleId) },
        add: async (role) => memberRoles.add(role.id),
        remove: async (role) => memberRoles.delete(role.id),
      },
      voice: { channel: null },
      setNickname: async function (nickname) {
        this.nickname = nickname;
      },
    };
    members.set(id, member);
    return member;
  };

  const sysPlusRoles = whitelisted ? [SYS_PLUS_ROLE, WHITELIST_ROLE] : [SYS_PLUS_ROLE];
  // The actor outranks the target: DOG now refuses equal or higher ranked targets.
  makeMember(ownerId, sysPlusRoles, 5);
  const target = makeMember(targetId, []);

  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "dog",
    options: { getUser: () => target.user },
    user: { id: ownerId, tag: `${ownerId}#0001`, username: ownerId },
    guild,
    channel: {},
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };

  await handleV4SlashInteraction(interaction, settings);
  assert.ok(replies.length >= 1, "le routeur doit répondre à /dog");
  return String(replies[0].content ?? replies[0]);
}

const sysPlusSettings = { sysPlus: { roleId: SYS_PLUS_ROLE, whitelistRoleId: WHITELIST_ROLE } };

test("a configured limit of 5 allows the fourth and fifth leash, then refuses a sixth", async () => {
  const settings = { ...sysPlusSettings, dog: { maxActiveLeashes: 5 } };

  const fourth = await runDog({ guildId: "guild-a", ownerId: "owner-a", settings, targetId: "new-4" });
  assert.match(fourth, /\(4\/5\)/);

  const fifth = await runDog({ guildId: "guild-a", ownerId: "owner-a", settings, targetId: "new-5" });
  assert.match(fifth, /\(5\/5\)/);

  const sixth = await runDog({ guildId: "guild-a", ownerId: "owner-a", settings, targetId: "new-6" });
  assert.match(sixth, /⛔/);
  assert.match(sixth, /5\/5/);
});

test("without a stored DOG setting the historical limit of 3 still applies", async () => {
  const refused = await runDog({
    guildId: "guild-c",
    ownerId: "owner-c",
    settings: { ...sysPlusSettings },
    targetId: "new-c",
  });
  assert.match(refused, /⛔/);
  assert.match(refused, /3\/3/);
});

test("a configured limit in one guild does not change another guild's quota", async () => {
  // guild-d has a limit of 5 and 3 active leashes: a fourth is allowed.
  const allowed = await runDog({
    guildId: "guild-d",
    ownerId: "owner-d",
    settings: { ...sysPlusSettings, dog: { maxActiveLeashes: 5 } },
    targetId: "new-d",
  });
  assert.match(allowed, /\(4\/5\)/);

  // guild-c has no DOG setting and the same number of leashes: still refused at 3.
  const refused = await runDog({
    guildId: "guild-c",
    ownerId: "owner-c",
    settings: { ...sysPlusSettings },
    targetId: "new-c2",
  });
  assert.match(refused, /3\/3/);
});

test("an invalid stored limit falls back to the historical limit of 3", async () => {
  const refused = await runDog({
    guildId: "guild-c",
    ownerId: "owner-c",
    settings: { ...sysPlusSettings, dog: { maxActiveLeashes: 99 } },
    targetId: "new-c3",
  });
  assert.match(refused, /3\/3/);
});

test("WHITELIST still exceeds a configured limit and is labelled as an exception", async () => {
  const settings = { ...sysPlusSettings, dog: { maxActiveLeashes: 5 } };
  const reply = await runDog({
    guildId: "guild-e",
    ownerId: "owner-w",
    whitelisted: true,
    settings,
    targetId: "new-e",
  });
  assert.match(reply, /exception WHITELIST/);
});
