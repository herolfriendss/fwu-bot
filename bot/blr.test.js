import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GuildMemberRoleManager, PermissionFlagsBits as P } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "fwu-blr-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const OWNER = "900000000000000009";
const env = { PND_OWNER_DISCORD_ID: OWNER };

const blr = await import("./blr.js");
const shield = await import("./blr-shield.js");
const commands = await import("./blr-commands.js");
const { planRankAll } = await import("./rankall-policy.js");
const { protectedRoleReason, roleGrantRefusal } = await import("./role-grant-guard.js");
const { setRoleTiersForTests } = await import("./shared/tiers.js");
const { db } = await import("./database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const GUILD_ID = "100000000000000001";
const BLR_ROLE = "500000000000000001";
const MEMBER_ROLE = "500000000000000002";
const VIP = "500000000000000003";
const MOD = "500000000000000004";
blr.setBlrConfig(GUILD_ID, { blrRoleId: BLR_ROLE, memberRoleId: MEMBER_ROLE });
setRoleTiersForTests(GUILD_ID, [["600000000000000001", 1]]);

function makeGuild() {
  const roles = new Map([
    [GUILD_ID, { id: GUILD_ID, name: "@everyone", managed: false, permissions: 0n, position: 0 }],
    [BLR_ROLE, { id: BLR_ROLE, name: "BLR", managed: false, permissions: 0n, position: 1 }],
    [MEMBER_ROLE, { id: MEMBER_ROLE, name: "Membre", managed: false, permissions: 0n, position: 2 }],
    [VIP, { id: VIP, name: "VIP", managed: false, permissions: 0n, position: 3 }],
    [MOD, { id: MOD, name: "Modo", managed: false, permissions: P.BanMembers, position: 4 }],
    ["500000000000000009", { id: "500000000000000009", name: "Booster", managed: true, permissions: 0n, position: 5 }],
  ]);
  const guild = { id: GUILD_ID, ownerId: "100000000000000002", roles: { cache: roles }, client: { user: { id: "bot" } }, logs: [] };
  guild.fetchAuditLogs = async () => ({ entries: { find: (fn) => [{ target: { id: "300000000000000003" }, createdTimestamp: Date.now(), executor: { id: "777000000000000007" } }].find(fn) } });
  return guild;
}

function makeMember(guild, id, roleIds, { tierRole = null } = {}) {
  const cache = new Map(roleIds.map((rid) => [rid, guild.roles.cache.get(rid)]));
  if (tierRole) cache.set(tierRole, { id: tierRole, name: "Palier", managed: false, permissions: 0n });
  const member = {
    id, guild, user: { id, bot: false },
    roles: {
      cache,
      add: async (r) => { for (const x of [r].flat()) { const rid = typeof x === "string" ? x : x.id; shield.assertBlrAllows(guild, id, [rid], { currentRoleIds: [...cache.keys()] }); cache.set(rid, guild.roles.cache.get(rid)); } },
      remove: async (r) => { for (const x of [r].flat()) cache.delete(typeof x === "string" ? x : x.id); },
    },
    permissions: { has: () => false },
  };
  return member;
}

test("an allowed role passes, any other role is refused for a BLR member", () => {
  const guild = makeGuild();
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000001", savedRoles: [] });
  assert.doesNotThrow(() => shield.assertBlrAllows(guild, "300000000000000001", [MEMBER_ROLE]));
  assert.doesNotThrow(() => shield.assertBlrAllows(guild, "300000000000000001", ["500000000000000009"]), "managed roles cannot be removed anyway");
  assert.throws(() => shield.assertBlrAllows(guild, "300000000000000001", [VIP]), /BLR/);
  assert.doesNotThrow(() => shield.assertBlrAllows(guild, "300000000000000099", [VIP]), "non-BLR untouched");
  assert.doesNotThrow(() => blr.runBlrInternal(() => shield.assertBlrAllows(guild, "300000000000000001", [VIP])), "BLR module itself passes");
});

test("the discord.js hook refuses before anything is sent to Discord", async () => {
  shield.installBlrShield();
  const guild = makeGuild();
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000002", savedRoles: [] });
  const manager = Object.create(GuildMemberRoleManager.prototype);
  Object.defineProperty(manager, "guild", { value: guild });
  Object.defineProperty(manager, "member", { value: { id: "300000000000000002" } });
  Object.defineProperty(manager, "cache", { value: new Map() });
  await assert.rejects(() => manager.add(VIP, "test"), (error) => error.code === "BLR_PROTECTED");
});

test("role-grant-guard is aware of the person: even the OWNER cannot rank a BLR member", async () => {
  const guild = makeGuild();
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000003", savedRoles: [] });
  const vip = guild.roles.cache.get(VIP);
  assert.match(await roleGrantRefusal(guild, vip, { actorId: OWNER, targetId: "300000000000000003", env }), /BLR/);
  assert.match(await roleGrantRefusal(guild, vip, { automatic: true, targetId: "300000000000000003", env }), /BLR/);
  assert.equal(await roleGrantRefusal(guild, guild.roles.cache.get(MEMBER_ROLE), { automatic: true, targetId: "300000000000000003", env }), null);
  assert.equal(protectedRoleReason({ role: vip, guildId: GUILD_ID }), null, "role itself is harmless");
});

test("rankall ignores BLR members in its plan", () => {
  const guild = makeGuild();
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000004", savedRoles: [] });
  const mk = (id) => ({ id, user: { bot: false }, roles: { cache: new Map(), highest: { position: 1 } } });
  const plan = planRankAll({
    members: [mk("300000000000000004"), mk("300000000000000005")], role: { id: VIP, position: 3, managed: false },
    guild, actor: { id: OWNER, roles: { highest: { position: 99 } } }, botMember: { id: "bot", roles: { highest: { position: 99 } } },
    blocked: (m) => (blr.blrGrantRefusal(GUILD_ID, m.id, VIP) ? "membre BLR" : null),
  });
  assert.deepEqual(plan.eligible.map((m) => m.id), ["300000000000000005"]);
  assert.equal(plan.skipped[0].reason, "membre BLR");
});

test("restorations (quarantine end…) are filtered for a BLR member", () => {
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000006", savedRoles: [] });
  assert.deepEqual(blr.filterRolesForBlr(GUILD_ID, "300000000000000006", [VIP, MEMBER_ROLE, MOD]), [MEMBER_ROLE]);
  assert.deepEqual(blr.filterRolesForBlr(GUILD_ID, "300000000000000098", [VIP, MOD]), [VIP, MOD]);
});

test("setting a BLR: only OWNER and tiers 0/1, never on the OWNER, the server owner or a bot", async () => {
  const guild = makeGuild();
  const target = makeMember(guild, "300000000000000010", [GUILD_ID, VIP, MOD, MEMBER_ROLE, "500000000000000009"]);
  const nobody = makeMember(guild, "200000000000000020", [GUILD_ID]);
  assert.match((await commands.setBlr({ guild, actor: nobody, target, env })).message, /paliers 0 % et 1 %/);
  const tier1 = makeMember(guild, "200000000000000021", [GUILD_ID], { tierRole: "600000000000000001" });
  assert.match((await commands.setBlr({ guild, actor: tier1, target: makeMember(guild, OWNER, [GUILD_ID]), env })).message, /OWNER/);
  assert.match((await commands.setBlr({ guild, actor: tier1, target: makeMember(guild, guild.ownerId, [GUILD_ID]), env })).message, /propriétaire/);
  const bot = makeMember(guild, "200000000000000099", [GUILD_ID]); bot.user.bot = true;
  assert.match((await commands.setBlr({ guild, actor: tier1, target: bot, env })).message, /bot/);
  const done = await commands.setBlr({ guild, actor: tier1, target, reason: "raid", durationText: "7j", env });
  assert.equal(done.ok, true);
  assert.ok(done.caseNumber >= 1);
  assert.deepEqual([...target.roles.cache.keys()].sort(), [GUILD_ID, BLR_ROLE, MEMBER_ROLE, "500000000000000009"].sort());
  const state = blr.getBlr(GUILD_ID, target.id);
  assert.deepEqual(state.savedRoles.sort(), [VIP, MOD].sort());
  assert.ok(state.expiresAt > Date.now());
});

test("a BLR member who receives a role loses it at once; a feedback loop is capped", async () => {
  const guild = makeGuild();
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000003", savedRoles: [] });
  const member = makeMember(guild, "300000000000000003", [GUILD_ID, MEMBER_ROLE, BLR_ROLE]);
  member.roles.cache.set(VIP, guild.roles.cache.get(VIP)); // donné par un autre bot ou à la main
  const codes = [];
  const now = 1_000_000;
  assert.equal(await commands.handleBlrMemberUpdate(null, member, { record: (c) => codes.push(c), now }), true);
  assert.equal(member.roles.cache.has(VIP), false);
  assert.ok(codes.includes("blr_reverted"));
  for (let i = 0; i < 4; i += 1) { member.roles.cache.set(VIP, guild.roles.cache.get(VIP)); await commands.handleBlrMemberUpdate(null, member, { record: (c) => codes.push(c), now: now + i }); }
  member.roles.cache.set(VIP, guild.roles.cache.get(VIP));
  assert.equal(await commands.handleBlrMemberUpdate(null, member, { record: (c) => codes.push(c), now: now + 10 }), false);
  assert.ok(codes.includes("blr_loop_guard"));
  // Sans rôle en trop : rien (le bot ignore ses propres corrections).
  member.roles.cache.delete(VIP);
  assert.equal(await commands.handleBlrMemberUpdate(null, member, { now: now + 120_000 }), false);
});

test("a BLR member who leaves and comes back gets the BLR state back from the database", async () => {
  const guild = makeGuild();
  blr.recordBlr({ guildId: GUILD_ID, userId: "300000000000000011", savedRoles: [VIP] });
  const back = makeMember(guild, "300000000000000011", [GUILD_ID, VIP]); // rôle automatique donné à l'arrivée
  assert.equal(await commands.handleBlrMemberAdd(back), true);
  assert.deepEqual([...back.roles.cache.keys()].sort(), [GUILD_ID, BLR_ROLE, MEMBER_ROLE].sort());
});

test("lifting restores only on request and only roles that pass the guard", async () => {
  const guild = makeGuild();
  const target = makeMember(guild, "300000000000000012", [GUILD_ID, MEMBER_ROLE, BLR_ROLE]);
  blr.recordBlr({ guildId: GUILD_ID, userId: target.id, savedRoles: [VIP, MOD] });
  const tier1 = makeMember(guild, "200000000000000021", [GUILD_ID], { tierRole: "600000000000000001" });
  const result = await commands.liftBlr({ guild, actorId: tier1.id, actor: tier1, target, restore: true, env });
  assert.equal(result.ok, true);
  assert.deepEqual(result.restored, [VIP]);
  assert.deepEqual(result.refused, [MOD], "privileged role refused unless OWNER");
  assert.equal(target.roles.cache.has(BLR_ROLE), false);
  assert.equal(blr.isBlr(GUILD_ID, target.id), false);
  const plain = makeMember(guild, "300000000000000013", [GUILD_ID, MEMBER_ROLE, BLR_ROLE]);
  blr.recordBlr({ guildId: GUILD_ID, userId: plain.id, savedRoles: [VIP] });
  const noRestore = await commands.liftBlr({ guild, actorId: OWNER, target: plain, restore: false, env });
  assert.equal(noRestore.ok, true);
  assert.equal(plain.roles.cache.has(VIP), false);
});

test("startup sweep re-applies every BLR and lifts the expired ones", async () => {
  const guild = makeGuild();
  const stale = makeMember(guild, "300000000000000014", [GUILD_ID, VIP, MEMBER_ROLE, BLR_ROLE]);
  const expired = makeMember(guild, "300000000000000015", [GUILD_ID, MEMBER_ROLE, BLR_ROLE]);
  blr.recordBlr({ guildId: GUILD_ID, userId: stale.id, savedRoles: [] });
  blr.recordBlr({ guildId: GUILD_ID, userId: expired.id, savedRoles: [], expiresAt: Date.now() - 1000 }, Date.now() - 5000);
  const members = new Map([[stale.id, stale], [expired.id, expired]]);
  guild.members = { fetch: async (id) => members.get(id) ?? null };
  const otherIds = blr.listActiveBlr().map((s) => s.userId).filter((id) => !members.has(id));
  for (const id of otherIds) blr.markBlrLifted(GUILD_ID, id, null);
  await commands.sweepBlr({ guilds: { cache: new Map([[GUILD_ID, guild]]) } });
  assert.equal(stale.roles.cache.has(VIP), false);
  assert.equal(blr.isBlr(GUILD_ID, expired.id, 0), false);
  assert.equal(expired.roles.cache.has(BLR_ROLE), false);
});

test("duration parsing", () => {
  assert.equal(blr.parseBlrDuration("7j"), 7 * 86_400_000);
  assert.equal(blr.parseBlrDuration("définitif"), null);
  assert.equal(blr.parseBlrDuration(""), null);
  assert.throws(() => blr.parseBlrDuration("bientôt"), /Durée/);
});
