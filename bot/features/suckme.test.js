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
