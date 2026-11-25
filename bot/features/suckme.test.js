import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionFlagsBits as P } from "discord.js";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-suckme-")), "db.sqlite");
process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
const s = await import("./suckme.js");
const { db } = await import("../database.js");

test("role grants respect the bot, the actor's rank and dangerous permissions", () => {
  const role = (position, perms = []) => ({ id: "r", position, managed: false, permissions: { has: (f) => perms.includes(f) } });
  const base = { botPosition: 50, actorPosition: 20, actorFull: false, guildId: "g" };
  assert.equal(s.roleGrantRefusal({ ...base, role: role(10) }), null);
  assert.match(s.roleGrantRefusal({ ...base, role: role(20) }), /sous ton rôle/);
  assert.match(s.roleGrantRefusal({ ...base, role: role(60) }), /au-dessus de mon rôle/);
  assert.match(s.roleGrantRefusal({ ...base, role: role(10, [P.BanMembers]) }), /Seul l'OWNER/);
  assert.equal(s.roleGrantRefusal({ ...base, actorFull: true, role: role(30, [P.BanMembers]) }), null);
});

test("expired temporary roles are removed once", async () => {
  db.prepare("INSERT INTO suckme_temp_roles(guild_id,user_id,role_id,expires_at,given_by) VALUES('g','u','r',5,'a')").run();
  const removed = [];
  const member = { roles: { cache: new Map([["r", {}]]), remove: async (r) => removed.push(r) } };
  const client = { guilds: { cache: new Map([["g", { members: { fetch: async () => member } }]]) } };
  assert.equal(await s.runTempRoles(client, 10), 1);
  assert.deepEqual(removed, ["r"]);
  assert.equal(await s.runTempRoles(client, 10), 0);
});

test("scheduled announcements are published with only the chosen role pinged", async () => {
  db.prepare("INSERT INTO suckme_announcements(guild_id,channel_id,title,body,color,role_id,author_id,due_at,created_at) VALUES('g','c','Event','Ce soir 21h',NULL,'role9','a',5,1)").run();
  const sent = [];
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => sent.push(p) }) } };
  assert.equal(await s.runAnnouncements(client, 10), 1);
  assert.equal(sent[0].content, "<@&role9>");
  assert.deepEqual(sent[0].allowedMentions, { roles: ["role9"] });
  assert.equal(sent[0].embeds[0].data.title, "Event");
});

test("staff ladder: promote and demote one step", () => {
  const ladder = ["helper", "modo", "admin"];
  assert.deepEqual(s.ladderStep(ladder, ["x"], 1), { add: "helper", remove: null });
  assert.deepEqual(s.ladderStep(ladder, ["helper"], 1), { add: "modo", remove: "helper" });
  assert.deepEqual(s.ladderStep(ladder, ["modo"], -1), { add: "helper", remove: "modo" });
  assert.deepEqual(s.ladderStep(ladder, ["helper"], -1), { add: null, remove: "helper" });
  assert.match(s.ladderStep(ladder, ["admin"], 1).error, /sommet/);
  assert.match(s.ladderStep(ladder, ["x"], -1).error, /pas dans l'échelle/);
});

// ── Sécurité : un SYS+ ne peut pas se donner de droits ───────────────────────
const { setRoleTiersForTests, forgetTierCache } = await import("../shared/tiers.js");

function suckmeWorld({ actorId = "300000000000000009", sysRoleId = "sys", roles, memberRoleIds = [] }) {
  const roleMap = new Map(roles.map((r) => [r.id, { managed: false, permissions: { has: () => false, bitfield: 0n }, ...r }]));
  const added = [];
  const member = { id: actorId, roles: { highest: { position: 20 }, cache: new Map([[sysRoleId, roleMap.get(sysRoleId)], ...memberRoleIds.map((id) => [id, roleMap.get(id)])]), add: async (role) => added.push(typeof role === "string" ? role : role.id), remove: async () => {} } };
  const guild = { id: "g-sec", ownerId: "999", roles: { cache: roleMap }, members: { me: { roles: { highest: { position: 50 } } }, fetch: async () => member } };
  member.guild = guild;
  let answer = null;
  const interaction = (commandName, sub, options) => ({
    commandName, guild, member, user: { id: actorId },
    isChatInputCommand: () => true,
    deferReply: async () => {}, editReply: async (p) => { answer = p.content; },
    options: {
      getSubcommand: () => sub,
      getUser: () => ({ id: actorId }),
      getRole: (name) => options[name] ?? null,
      getString: (name) => options[name] ?? null,
    },
  });
  return { interaction, added, roleMap, answer: () => answer, settings: { sysPlus: { roleId: sysRoleId } } };
}

test("sécurité : /roletemp refuse au SYS+ un rôle de palier, ADMIN+ ou à permissions", async () => {
  setRoleTiersForTests("g-sec", [["modo10", 10]]);
  const w = suckmeWorld({ roles: [
    { id: "sys", position: 15 }, { id: "modo10", position: 5 }, { id: "adminplus", position: 6 }, { id: "deco", position: 4 },
  ] });
  const settings = { ...w.settings, adminPlus: { roleId: "adminplus" } };
  await s.handleSuckmeInteraction(w.interaction("roletemp", "donner", { role: w.roleMap.get("modo10"), duree: "1h" }), settings);
  assert.match(w.answer(), /palier 10/);
  await s.handleSuckmeInteraction(w.interaction("roletemp", "donner", { role: w.roleMap.get("adminplus"), duree: "1h" }), settings);
  assert.match(w.answer(), /ADMIN\+/);
  assert.deepEqual(w.added, [], "aucun rôle protégé donné");
  await s.handleSuckmeInteraction(w.interaction("roletemp", "donner", { role: w.roleMap.get("deco"), duree: "1h" }), settings);
  assert.deepEqual(w.added, ["deco"], "un rôle cosmétique reste possible");
  forgetTierCache();
});

test("sécurité : /staff — échelle limitée aux rôles donnables, pas d'auto-promotion", async () => {
  setRoleTiersForTests("g-sec", [["modo10", 10]]);
  const w = suckmeWorld({ roles: [{ id: "sys", position: 15 }, { id: "modo10", position: 5 }, { id: "helper", position: 3 }, { id: "chef", position: 30 }], memberRoleIds: ["helper"] });
  await s.handleSuckmeInteraction(w.interaction("staff", "echelle", { role1: w.roleMap.get("helper"), role2: w.roleMap.get("modo10") }), w.settings);
  assert.match(w.answer(), /palier 10/);
  await s.handleSuckmeInteraction(w.interaction("staff", "echelle", { role1: w.roleMap.get("helper"), role2: w.roleMap.get("chef") }), w.settings);
  assert.match(w.answer(), /sous ton rôle/, "un rôle au-dessus de l'auteur ne peut plus entrer dans l'échelle");
  s.saveLadder("g-sec", ["helper", "deco-inexistant"]);
  await s.handleSuckmeInteraction(w.interaction("staff", "promouvoir", {}), w.settings);
  assert.match(w.answer(), /toi-même/);
  assert.deepEqual(w.added, []);
  forgetTierCache();
});
