import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./database.js";
import {
  BLACKLIST_DENIED,
  addToBlacklist,
  canUseBlacklist,
  enforceBlacklistOnJoin,
  handleBlacklistMessage,
  isBlacklisted,
  parseBlacklistPrefix,
  removeFromBlacklist,
  runBlacklistAction,
} from "./blacklist.js";

const OWNER = "100000000000000001";
const SYS = "100000000000000002";
const MEMBER = "100000000000000003";
const HIGH = "100000000000000004";
const GUILD_OWNER = "100000000000000009";
const SYS_ROLE = "200000000000000001";
process.env.PND_OWNER_DISCORD_ID = OWNER;
const reset = () => db.exec("DELETE FROM blacklist_entries");

function makeMember(id, position, roles = []) {
  return { id, roles: { highest: { position }, cache: new Map(roles.map((r) => [r, {}])) }, guild: { id: "g" }, permissions: { has: () => false } };
}

function makeGuild({ canBan = true } = {}) {
  const present = new Map([[MEMBER, makeMember(MEMBER, 1)], [HIGH, makeMember(HIGH, 9)]]);
  const bans = [];
  return {
    id: "g",
    ownerId: GUILD_OWNER,
    client: { user: { id: "999999999999999999" } },
    bans: {
      create: async (id, opts) => { if (!canBan) throw new Error("perm"); bans.push({ id, opts }); },
      remove: async (id) => { if (!canBan) throw new Error("perm"); const i = bans.findIndex((b) => b.id === id); if (i < 0) throw Object.assign(new Error("unknown ban"), { code: 10026 }); bans.splice(i, 1); },
    },
    banned: bans,
    members: {
      fetch: async ({ user }) => { if (present.has(user)) return present.get(user); throw Object.assign(new Error("unknown"), { code: 10007 }); },
      fetchMe: async () => makeMember("999999999999999999", 10),
    },
  };
}

test("access: OWNER and SYS+ only", () => {
  const settings = { sysPlus: { roleId: SYS_ROLE } };
  assert.equal(canUseBlacklist(makeMember(OWNER, 5), settings), true);
  assert.equal(canUseBlacklist(makeMember(SYS, 5, [SYS_ROLE]), settings), true);
  assert.equal(canUseBlacklist(makeMember(MEMBER, 5), settings), false);
});

test("add bans by ID, even an absent account, and is idempotent", async () => {
  reset();
  const guild = makeGuild();
  const actor = makeMember(SYS, 5, [SYS_ROLE]);
  const absent = "100000000000000077";
  const first = await addToBlacklist({ guild, actor, userId: absent, reason: "raid" });
  assert.deepEqual({ added: first.added, banned: first.banned, present: first.present }, { added: true, banned: true, present: false });
  assert.match(guild.banned[0].opts.reason, /^Blacklist .*raid/);
  assert.equal(isBlacklisted("g", absent), true);
  const again = await addToBlacklist({ guild, actor, userId: absent, reason: "raid 2" });
  assert.equal(again.alreadyListed, true);
});

test("hierarchy and protected accounts are refused, nothing stored", async () => {
  reset();
  const guild = makeGuild();
  const actor = makeMember(SYS, 5, [SYS_ROLE]);
  await assert.rejects(addToBlacklist({ guild, actor, userId: OWNER }), /protégée/);
  await assert.rejects(addToBlacklist({ guild, actor, userId: GUILD_OWNER }), /protégée/);
  await assert.rejects(addToBlacklist({ guild, actor, userId: SYS }), /toi-même/);
  await assert.rejects(addToBlacklist({ guild, actor, userId: HIGH }), /inférieur/);
  await assert.rejects(addToBlacklist({ guild, actor, userId: "abc" }), /invalide/);
  assert.equal(isBlacklisted("g", HIGH), false);
  // The OWNER is not bound by role rank (only by the bot's own position).
  const owner = makeMember(OWNER, 0);
  assert.equal((await addToBlacklist({ guild, actor: owner, userId: HIGH })).banned, true);
});

test("missing ban permission: still listed, honest message", async () => {
  reset();
  const text = await runBlacklistAction({ guild: makeGuild({ canBan: false }), actor: makeMember(OWNER, 5), action: "add", userId: MEMBER });
  assert.match(text, /pas pu le bannir/);
  assert.equal(isBlacklisted("g", MEMBER), true);
});

test("remove also unbans (owner decision); list and check", async () => {
  reset();
  const guild = makeGuild();
  await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "add", userId: MEMBER, reason: "spam" });
  assert.match(await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "list" }), /Blacklist \(1\)[\s\S]*spam/);
  assert.match(await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "check", userId: MEMBER }), /Blacklisté/);
  assert.equal(guild.banned.length, 1);
  assert.match(await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "remove", userId: MEMBER }), /retiré de la blacklist et débanni/);
  assert.equal(guild.banned.length, 0, "le bannissement Discord est levé");
  assert.equal(removeFromBlacklist("g", MEMBER), false);
  assert.match(await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "list" }), /vide/);
});

test("a blacklisted account is banned again when it rejoins", async () => {
  reset();
  await addToBlacklist({ guild: makeGuild(), actor: makeMember(OWNER, 5), userId: MEMBER });
  const bans = [];
  const joined = { id: MEMBER, guild: { id: "g" }, ban: async (opts) => bans.push(opts) };
  assert.equal(await enforceBlacklistOnJoin(joined), true);
  assert.equal(bans.length, 1);
  assert.equal(await enforceBlacklistOnJoin({ id: "100000000000000055", guild: { id: "g" }, ban: async () => bans.push(1) }), false);
  assert.equal(bans.length, 1);
});

test("prefix parsing and refusal", async () => {
  assert.deepEqual(parseBlacklistPrefix("=blacklist add <@100000000000000003> pub"), { action: "add", userId: "100000000000000003", reason: "pub" });
  assert.deepEqual(parseBlacklistPrefix("=blacklist ajouter 100000000000000003"), { action: "add", userId: "100000000000000003", reason: "" });
  assert.deepEqual(parseBlacklistPrefix("=blacklist"), { action: "list", userId: null, reason: "" });
  assert.deepEqual(parseBlacklistPrefix("=blacklist <@100000000000000003>"), { action: "check", userId: "100000000000000003", reason: "" });
  assert.equal(parseBlacklistPrefix("=blacklisted"), null);
  const replies = [];
  const message = { content: "=blacklist list", guild: { id: "g" }, member: makeMember(MEMBER, 1), reply: async (p) => replies.push(p) };
  assert.equal(await handleBlacklistMessage(message, {}), true);
  assert.equal(replies[0].content, BLACKLIST_DENIED);
});

test("remove: honest messages when not banned anymore or permission missing", async () => {
  reset();
  const guild = makeGuild();
  await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "add", userId: MEMBER });
  guild.banned.length = 0; // unbanned by hand meanwhile
  assert.match(await runBlacklistAction({ guild, actor: makeMember(OWNER, 5), action: "remove", userId: MEMBER }), /n'était plus banni/);
  const noPerm = makeGuild({ canBan: false });
  await runBlacklistAction({ guild: noPerm, actor: makeMember(OWNER, 5), action: "add", userId: MEMBER });
  assert.match(await runBlacklistAction({ guild: noPerm, actor: makeMember(OWNER, 5), action: "remove", userId: MEMBER }), /pas pu le débannir/);
  assert.equal(isBlacklisted("g", MEMBER), false);
});
