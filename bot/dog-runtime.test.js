import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-dog-runtime-"));
const statePath = join(directory, "dog-state.json");
process.env.PND_DOG_STATE_PATH = statePath;
process.env.HER_DB_PATH = join(directory, "economy.sqlite");

const seededRecords = Object.fromEntries(
  ["member-1", "member-2", "member-3"].map((memberId, index) => [
    `guild-a:${memberId}`,
    {
      guildId: "guild-a",
      memberId,
      ownerId: "owner-a",
      ownerName: "Owner A",
      since: Date.now() - index * 1000,
      previousNickname: null,
      leashRoleId: "leash-role",
    },
  ]),
);
seededRecords["guild-b:private-member"] = {
  guildId: "guild-b", memberId: "private-member", ownerId: "private-owner", ownerName: "Other guild",
  since: Date.now(), previousNickname: null, leashRoleId: "other-role",
};
writeFileSync(statePath, JSON.stringify(seededRecords));

const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { db } = await import("./database.js");

test("DOG WHITELIST excess is audited and the saved leash is restored after module restart", async (context) => {
  context.after(() => {
    db.close();
    delete process.env.PND_DOG_STATE_PATH;
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  const role = {
    id: "leash-role",
    name: "En laisse",
    managed: false,
    position: 2,
  };
  const roleItems = [];
  const roleCache = {
    find: (predicate) => roleItems.find(predicate),
    get: (id) => roleItems.find((item) => item.id === id),
  };
  const botMember = {
    permissions: { has: () => true },
    roles: { highest: { position: 10 } },
  };
  const makeMember = (id, { owner = false, whitelisted = false } = {}) => {
    const memberRoleIds = new Set(whitelisted ? ["whitelist-role"] : []);
    const member = {
      id,
      guild: null,
      user: { id, username: id, tag: `${id}#0001` },
      displayName: owner ? "Owner A" : id,
      nickname: owner ? null : "Old nickname",
      permissions: { has: () => false },
      roles: {
        highest: { position: 1 },
        cache: {
          has: (roleId) => memberRoleIds.has(roleId),
          highest: { position: 1 },
        },
        add: async (addedRole) => memberRoleIds.add(addedRole.id),
        remove: async (removedRole) => memberRoleIds.delete(removedRole.id),
      },
      voice: { channel: null },
      setNickname: async function (nickname) {
        this.nickname = nickname;
      },
    };
    return member;
  };
  const owner = makeMember("owner-a", { owner: true, whitelisted: true });
  owner.roles.cache.has = (roleId) => roleId === "sysplus-role" || roleId === "whitelist-role";
  const target = makeMember("member-4");
  const cache = new Map([
    [owner.id, owner],
    [target.id, target],
  ]);
  const guild = {
    id: "guild-a",
    ownerId: owner.id,
    members: {
      cache: { get: (id) => cache.get(id) ?? null },
      fetchMe: async () => botMember,
      fetch: async (id) => cache.get(typeof id === "string" ? id : id.user) ?? null,
    },
    roles: {
      cache: roleCache,
      create: async () => {
        roleItems.push(role);
        return role;
      },
    },
  };
  owner.guild = guild;
  target.guild = guild;
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "dog",
    options: { getUser: () => target.user },
    user: { id: owner.id, tag: "owner-a#0001", username: owner.id },
    guild,
    channel: {},
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };

  await handleV4SlashInteraction(interaction, { sysPlus: { roleId: "sysplus-role", whitelistRoleId: "whitelist-role" } });
  assert.match(replies[0].content, /4 \(exception WHITELIST\)/);
  assert.equal(target.nickname, "🦮 de Owner A");
  const audit = db
    .prepare("SELECT action,target_id,details FROM sysplus_audit WHERE guild_id=?")
    .get("guild-a");
  assert.equal(audit.action, "dog.whitelist_quota_exception");
  assert.equal(audit.target_id, target.id);
  assert.deepEqual(JSON.parse(audit.details), { activeBefore: 3, configuredLimit: 3 });

  const listReplies = [];
  await handleV4SlashInteraction({
    ...interaction,
    options: { getUser: () => null },
    editReply: async (payload) => listReplies.push(payload),
  }, { sysPlus: { roleId: "sysplus-role", whitelistRoleId: "whitelist-role" } });
  assert.match(listReplies[0].content, /Laisses actives/);
  assert.match(listReplies[0].content, /member-4/);
  assert.doesNotMatch(listReplies[0].content, /private-member|Other guild/);

  const persisted = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(persisted["guild-a:member-4"].ownerId, owner.id);
  const restarted = await import("./dog-commands.js?restart=1");
  target.nickname = "Changed after restart";
  roleItems.splice(0, roleItems.length, role);
  assert.equal(await restarted.enforceLeashNickname(target), true);
  assert.equal(target.nickname, "🦮 de Owner A");
  assert.equal(target.roles.cache.has(role.id), true);
});
