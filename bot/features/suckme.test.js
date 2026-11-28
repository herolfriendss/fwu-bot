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

function staffInteraction({ userId, sub, group = null, options = {}, guildId = "gs", staffRoleMembers = [] }) {
  const replies = [];
  const roles = new Map([["staffrole", { id: "staffrole", members: new Map(staffRoleMembers.map((id) => [id, {}])) }]]);
  return {
    replies,
    isChatInputCommand: () => true,
    commandName: "staff",
    user: { id: userId },
    member: { id: userId, roles: { cache: new Map() }, guild: { ownerId: "owner-discord" } },
    guildId,
    channelId: "chan-staff",
    guild: { id: guildId, ownerId: "owner-discord", roles: { cache: roles }, members: { fetch: async () => null } },
    options: { getSubcommand: () => sub, getSubcommandGroup: () => group, getString: (name) => options[name] ?? null, getInteger: (name) => options[name] ?? null, getUser: (name) => (options[name] ? { id: options[name] } : null) },
    deferReply: async () => {},
    editReply: async (payload) => { replies.push(payload.content); },
  };
}

test("STAFF CENTER: availability and on call are staff only and never give a role", async () => {
  s.saveLadder("gs", ["staffrole"]);
  const outsider = staffInteraction({ userId: "u-out", sub: "dispo", options: { creneaux: "lun 18-20" } });
  await s.handleSuckmeInteraction(outsider, {});
  assert.match(outsider.replies[0], /Réservé au staff/);

  const dispo = staffInteraction({ userId: "u-staff", sub: "dispo", options: { creneaux: "lun-ven 18-23" }, staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(dispo, {});
  assert.match(dispo.replies[0], /lun mar mer jeu ven 18h-23h/);

  const bad = staffInteraction({ userId: "u-staff", sub: "dispo", options: { creneaux: "n'importe quoi" }, staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(bad, {});
  assert.match(bad.replies[0], /illisible/);

  const take = staffInteraction({ userId: "u-staff", sub: "astreinte", options: { action: "prendre", duree: "4h" }, staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(take, {});
  assert.match(take.replies[0], /aucun rôle ni permission/);

  const who = staffInteraction({ userId: "u-staff", sub: "disponibles", staffRoleMembers: ["u-staff", "u-other"] });
  await s.handleSuckmeInteraction(who, {});
  assert.match(who.replies[0], /D'astreinte : <@u-staff>/);
  assert.match(who.replies[0], /Sans créneaux déclarés : 1/);

  const plan = staffInteraction({ userId: "u-staff", sub: "planning", staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(plan, {});
  assert.match(plan.replies[0], /Couverture du staff/);

  const note = staffInteraction({ userId: "u-staff", sub: "passation", options: { note: "Surveiller le salon général" }, staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(note, {});
  assert.match(note.replies[0], /Passation n°\d+ enregistrée/);
  const read = staffInteraction({ userId: "u-staff", sub: "passation", staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(read, {});
  assert.match(read.replies[0], /Surveiller le salon général/);
  const spy = staffInteraction({ userId: "u-out", sub: "passation" });
  await s.handleSuckmeInteraction(spy, {});
  assert.match(spy.replies[0], /Réservé au staff/);

  const end = staffInteraction({ userId: "u-staff", sub: "astreinte", options: { action: "terminer" }, staffRoleMembers: ["u-staff"] });
  await s.handleSuckmeInteraction(end, {});
  assert.match(end.replies[0], /terminée/);
});

test("STAFF CENTER: intervention files from opening to secondary validation", async () => {
  s.saveLadder("gs", ["staffrole"]);
  const staffIds = ["u-a", "u-b"];
  const run = async (userId, sub, options = {}) => {
    const i = staffInteraction({ userId, sub, group: "intervention", options, staffRoleMembers: staffIds });
    await s.handleSuckmeInteraction(i, {});
    return i.replies[0];
  };
  assert.match(await run("u-out", "ouvrir", { titre: "x" }), /Réservé au staff/);
  const opened = await run("u-a", "ouvrir", { titre: "Raid du soir", priorite: "haute" });
  const number = Number(opened.match(/n°(\d+)/)[1]);
  assert.match(await run("u-a", "assigner", { numero: number, membre: "u-out" }), /qu'à un membre du staff/);
  assert.match(await run("u-a", "assigner", { numero: number, membre: "u-b" }), /confié à <@u-b>/);
  assert.match(await run("u-b", "preuve", { numero: number, lien: "https://discord.com/channels/999999999999999999/1/2" }), /autre serveur/);
  assert.match(await run("u-b", "preuve", { numero: number, lien: "sanction:3" }), /sanction:3/);
  assert.match(await run("u-b", "cloturer", { numero: number, conclusion: "Comptes bannis" }), /un \*\*autre\*\* SYS\+/);
  // Plain staff member cannot validate (SYS+ / OWNER only).
  assert.match(await run("u-a", "valider", { numero: number }), /réservée/);
  assert.match(await run("u-a", "voir", { numero: number }), /Clôture demandée/);
});

test("STAFF CENTER: missions and meetings (managers create, staff report)", async () => {
  s.saveLadder("gs", ["staffrole"]);
  const run = async (userId, group, sub, options = {}, settings = {}) => {
    const i = staffInteraction({ userId, sub, group, options, staffRoleMembers: ["u-a", "u-b"] });
    await s.handleSuckmeInteraction(i, settings);
    return i.replies[0];
  };
  assert.match(await run("u-a", "mission", "creer", { titre: "Ranger les salons" }), /Seuls les SYS\+/);
  // The configured OWNER is a manager.
  const created = await run("100000000000000001", "mission", "creer", { titre: "Former Paul", membre: "u-a", echeance: "demain 20h" });
  const number = Number(created.match(/n°(\d+)/)[1]);
  assert.match(created, /pour <@u-a>/);
  assert.match(await run("100000000000000001", "mission", "creer", { titre: "x", membre: "u-out" }), /qu'à un membre du staff/);
  assert.match(await run("u-a", "mission", "liste"), /Former Paul/);
  assert.match(await run("u-b", "mission", "terminer", { numero: number, bilan: "x" }), /quelqu'un d'autre/);
  assert.match(await run("u-a", "mission", "terminer", { numero: number, bilan: "Paul formé" }), /terminée/);
  assert.match(await run("u-a", "reunion", "planifier", { sujet: "Bilan", date: "demain 21h" }), /Seuls les SYS\+/);
  assert.match(await run("100000000000000001", "reunion", "planifier", { sujet: "Bilan", date: "demain 21h" }), /Rappel ici 30 min avant/);
  assert.match(await run("u-b", "reunion", "liste"), /Bilan/);
});

test("meeting reminders go to the planning channel of the same server, never mass mentions", async () => {
  const { planMeeting } = await import("../staff-missions.js");
  const now = Date.now();
  planMeeting({ guildId: "gm", actorId: "s", topic: "Point", channelId: "cm", startsAt: now + 20 * 60_000 }, { now });
  planMeeting({ guildId: "gm", actorId: "s", topic: "Piège", channelId: "other-guild-chan", startsAt: now + 20 * 60_000 }, { now });
  const sent = [];
  const channels = { cm: { guildId: "gm", isTextBased: () => true, send: async (p) => sent.push(p) }, "other-guild-chan": { guildId: "zz", isTextBased: () => true, send: async (p) => sent.push(p) } };
  const client = { channels: { fetch: async (id) => channels[id] ?? null } };
  assert.equal(await s.runMeetingReminders(client, now), 1);
  assert.match(sent[0].content, /Point/);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(await s.runMeetingReminders(client, now), 0);
});

test("STAFF CENTER: training exercises and certification of a finished Academy track", async () => {
  const { createAcademyTrack, completeAcademyStep } = await import("../organization.js");
  const G = "200000000000000002";
  const A = "300000000000000003"; const B = "300000000000000004"; const OWNER = "100000000000000001";
  s.saveLadder(G, ["staffrole"]);
  const run = async (userId, sub, options = {}) => {
    const i = staffInteraction({ userId, sub, group: "formation", options, guildId: G, staffRoleMembers: [A, B] });
    await s.handleSuckmeInteraction(i, {});
    return i.replies[0];
  };
  assert.match(await run(A, "exercice", { type: "conflit", membre: B }), /Seuls les SYS\+/);
  const ex = await run(OWNER, "exercice", { type: "conflit", membre: B });
  const id = ex.match(/exercice `([0-9a-f]{8})`/)[1];
  assert.match(await run(A, "reponse", { id, reponses: "B,B,B,B" }), /Seul le stagiaire/);
  assert.match(await run(B, "reponse", { id, reponses: "B,B,B,B" }), /4\/4/);
  const track = createAcademyTrack(G, OWNER, "Modération 1", [{ title: "Bases", quiz: [{ prompt: "Q ?", choices: ["a", "b"], answerIndex: 1 }] }]);
  const short = track.trackId.slice(0, 8);
  assert.match(await run(OWNER, "valider", { membre: B, parcours: short }), /0\/1/);
  completeAcademyStep(G, track.trackId, B, 0, [1]);
  assert.match(await run(A, "valider", { membre: B, parcours: short }), /réservée/);
  assert.match(await run(OWNER, "valider", { membre: B, parcours: short }), /certifié.*aucun rôle/);
  assert.match(await run(A, "certifications", { membre: B }), /Modération 1.*\n.*Exercice de gestion de conflit 4\/4/);
});
