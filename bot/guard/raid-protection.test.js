import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType, PermissionFlagsBits as P } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "fwu-raid-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const OWNER = "900000000000000009";
const env = { PND_OWNER_DISCORD_ID: OWNER };

const R = await import("./raid-protection.js");
const { runRaidCommand } = await import("./raid-commands.js");
const blr = await import("../blr.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const GUILD_ID = "100000000000000001";
const BLR_ROLE = "500000000000000001";
const MEMBER_ROLE = "500000000000000002";
const VIP = "500000000000000003";
blr.setBlrConfig(GUILD_ID, { blrRoleId: BLR_ROLE, memberRoleId: MEMBER_ROLE });
const { setRoleTiersForTests } = await import("../shared/tiers.js");
setRoleTiersForTests(GUILD_ID, [["600000000000000001", 1]]);

function makeGuild() {
  const roles = new Map([[GUILD_ID, { id: GUILD_ID, permissions: 0n }], [BLR_ROLE, { id: BLR_ROLE, permissions: 0n }], [MEMBER_ROLE, { id: MEMBER_ROLE, permissions: 0n }], [VIP, { id: VIP, permissions: 0n }], ["600000000000000001", { id: "600000000000000001", name: "Palier 1", permissions: 0n }]]);
  const deleted = [];
  const channel = { id: "700000000000000001", type: ChannelType.GuildText, messages: { fetch: async () => new Map([["m1", { id: "m1", author: { id: "300000000000000003" }, createdTimestamp: Date.now() }]]) }, bulkDelete: async (ids) => { deleted.push(...ids); return { size: ids.length }; } };
  return { id: GUILD_ID, ownerId: "100000000000000002", roles: { cache: roles }, channels: { cache: new Map([[channel.id, channel]]) }, members: { me: { id: "bot" } }, client: { user: { id: "bot" } }, deleted, mfaLevel: 0, verificationLevel: 1, explicitContentFilter: 0 };
}
function makeMember(guild, id, roleIds, perms = () => false) {
  const cache = new Map(roleIds.map((r) => [r, guild.roles.cache.get(r)]));
  return { id, guild, user: { id, bot: false }, permissions: { has: perms }, roles: { cache, add: async (r) => { for (const x of [r].flat()) { const id = typeof x === "string" ? x : x.id; cache.set(id, guild.roles.cache.get(id)); } }, remove: async (r) => { for (const x of [r].flat()) cache.delete(typeof x === "string" ? x : x.id); } } };
}

test("trap: a non-exempt writer becomes BLR, loses recent messages; staff, SYS+, WHITELIST and bots are exempt", async () => {
  const guild = makeGuild();
  R.addTrapChannel(GUILD_ID, "700000000000000009");
  const member = makeMember(guild, "300000000000000003", [GUILD_ID, VIP, MEMBER_ROLE]);
  let removed = false;
  const message = { guild, channelId: "700000000000000009", author: { id: member.id, bot: false }, member, delete: async () => { removed = true; } };
  const line = await R.springBlrTrap(message, null, { env });
  assert.match(line, /BLR posé/);
  assert.equal(removed, true);
  assert.deepEqual(guild.deleted, ["m1"]);
  assert.equal(blr.isBlr(GUILD_ID, member.id), true);
  assert.equal(member.roles.cache.has(VIP), false);
  const settings = { sysPlus: { roleId: "800000000000000001", whitelistRoleId: "800000000000000003" }, adminPlus: { roleId: "800000000000000002" } };
  for (const exempt of [
    makeMember(guild, "300000000000000004", ["800000000000000001"]),
    makeMember(guild, "300000000000000005", ["800000000000000003"]),
    makeMember(guild, "300000000000000006", [], (bit) => bit === P.ManageMessages),
  ]) {
    assert.equal(R.isTrapExempt(exempt, settings, env), true);
    assert.equal(await R.springBlrTrap({ ...message, author: { id: exempt.id }, member: exempt }, settings, { env }), null);
  }
  assert.equal(await R.springBlrTrap({ ...message, author: { id: "x", bot: true } }, null, { env }), null);
  assert.equal(await R.springBlrTrap({ ...message, channelId: "other" }, null, { env }), null, "ordinary channels untouched");
});

test("pardon lifts the BLR with restoration, OWNER and tiers 0/1 only (no moderator bypass)", async () => {
  const guild = makeGuild();
  const target = makeMember(guild, "300000000000000013", [GUILD_ID, MEMBER_ROLE, BLR_ROLE]);
  blr.recordBlr({ guildId: GUILD_ID, userId: target.id, savedRoles: [VIP] });
  const staff = makeMember(guild, "200000000000000002", ["600000000000000001"]); // palier 1 %
  const moderator = makeMember(guild, "200000000000000004", [], (bit) => bit === P.ModerateMembers);
  const nobody = makeMember(guild, "200000000000000003", []);
  const members = new Map([[target.id, target], [staff.id, staff], [nobody.id, nobody], [moderator.id, moderator]]);
  guild.members.fetch = async (arg) => members.get(typeof arg === "string" ? arg : arg.user) ?? null;
  const client = { guilds: { cache: new Map([[GUILD_ID, guild]]) } };
  const replies = [];
  const click = (userId) => ({ customId: `trap:pardon:${GUILD_ID}:${target.id}`, user: { id: userId }, isButton: () => true, reply: async (p) => replies.push(p) });
  await R.handleTrapPardon(click(nobody.id), { client, env });
  assert.match(replies[0].content, /paliers 0 % et 1 %/);
  await R.handleTrapPardon(click(moderator.id), { client, env });
  assert.match(replies[1].content, /paliers 0 % et 1 %/, "un simple modérateur ne lève pas un BLR");
  assert.equal(blr.isBlr(GUILD_ID, target.id), true);
  await R.handleTrapPardon(click(staff.id), { client, env });
  assert.equal(blr.isBlr(GUILD_ID, target.id), false);
  assert.equal(target.roles.cache.has(VIP), true);
});

test("raid mode: automatic on a burst of joins, invites closed, automatic exit after calm; manual stays", async () => {
  const guild = makeGuild();
  let invites = null;
  guild.disableInvites = async (value) => { invites = value; };
  R.saveRaidSettings(GUILD_ID, { threshold: 3, windowSeconds: 30, calmMinutes: 5 });
  const t0 = 1_000_000_000;
  for (let i = 0; i < 2; i += 1) await R.recordJoinForRaid({ guild, user: { bot: false } }, { now: t0 + i });
  assert.equal(R.isRaidActive(GUILD_ID), false);
  await R.recordJoinForRaid({ guild, user: { bot: false } }, { now: t0 + 3 });
  assert.equal(R.isRaidActive(GUILD_ID), true);
  assert.equal(invites, true);
  const client = { guilds: { cache: new Map([[GUILD_ID, guild]]) } };
  await R.raidAutoExit(client, { now: t0 + 60_000 });
  assert.equal(R.isRaidActive(GUILD_ID), true, "not calm yet");
  await R.raidAutoExit(client, { now: t0 + 6 * 60_000 });
  assert.equal(R.isRaidActive(GUILD_ID), false);
  assert.equal(invites, false, "invites reopened");
  await R.setRaidMode(guild, true, { manual: true, now: t0 });
  await R.raidAutoExit(client, { now: t0 + 999 * 60_000 });
  assert.equal(R.isRaidActive(GUILD_ID), true, "manual raid mode is never auto-lifted");
  await R.setRaidMode(guild, false, { manual: true });
});

test("permission drift lists only newly gained sensitive permissions", () => {
  assert.deepEqual(R.permissionDrift(0n, P.Administrator | P.SendMessages), ["Administrator"]);
  assert.deepEqual(R.permissionDrift(P.BanMembers, P.BanMembers), []);
  assert.deepEqual(R.permissionDrift(P.BanMembers, P.BanMembers | P.ManageRoles), ["ManageRoles"]);
});

test("token detection never leaves the token in the channel", async () => {
  const fake = ["MTAxMjM0NTY3ODkwMTIzNDU2Nw", "AbCdEf", "abcdefghijklmnopqrstuvwxyz12345"].join(".");
  assert.equal(R.containsBotToken(`voici ${fake}`), true);
  assert.equal(R.containsBotToken("bonjour à tous"), false);
  let deleted = false;
  const ok = await R.handleTokenLeak({ guild: makeGuild(), content: fake, channelId: "1", author: { id: "300000000000000003" }, delete: async () => { deleted = true; } });
  assert.equal(ok, true);
  assert.equal(deleted, true);
});

test("scan scores the server and commands are admin-only", async () => {
  const guild = makeGuild();
  const result = R.scanGuild(guild);
  assert.ok(result.score < 100);
  assert.ok(result.findings.some((f) => /double authentification/i.test(f)));
  const nobody = makeMember(guild, "200000000000000003", []);
  assert.match((await runRaidCommand({ guild, member: nobody, sub: "scan" }, { env })).content, /administrateurs/);
  const admin = makeMember(guild, "200000000000000004", [], (bit) => bit === P.Administrator);
  const scan = await runRaidCommand({ guild, member: admin, sub: "scan" }, { env });
  assert.match(scan.embeds[0].title, /\/100/);
  const trap = await runRaidCommand({ guild, member: admin, sub: "piege configurer", channelId: "700000000000000010" }, { env });
  assert.match(trap.content, /BLR/);
  assert.ok(R.trapChannels(GUILD_ID).includes("700000000000000010"));
});

test("scan flags staff roles above the bot and a server without native AutoMod", async () => {
  const { scanGuild } = await import("./raid-protection.js");
  const perms = (admin) => ({ has: (p) => admin && (p === 8n || p === "Administrator"), toArray: () => (admin ? ["Administrator"] : []) });
  const role = (id, position, admin) => ({ id, position, managed: false, mentionable: false, permissions: { bitfield: admin ? 8n : 0n, has: () => admin, toArray: () => (admin ? ["Administrator"] : []) } });
  const roles = new Map([["g", role("g", 0, false)], ["staff", role("staff", 9, true)], ["bot", role("bot", 5, false)]]);
  const guild = { id: "g", mfaLevel: 1, verificationLevel: 3, explicitContentFilter: 2, roles: { cache: roles }, members: { cache: new Map(), me: { id: "me", roles: { highest: { position: 5 } } } } };
  const text = scanGuild(guild, { automodRuleCount: 0 }).findings.join("\n");
  assert.match(text, /au-dessus de mon rôle/);
  assert.match(text, /AutoMod native/);
  assert.doesNotMatch(scanGuild(guild, { automodRuleCount: null }).findings.join("\n"), /AutoMod/, "non vérifiable : pas de pénalité");
});
