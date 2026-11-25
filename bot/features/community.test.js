import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-community-")), "db.sqlite");
const c = await import("./community.js");
const { db } = await import("../database.js");

test("level curve and XP accumulation", () => {
  assert.equal(c.xpForNextLevel(0), 100);
  assert.deepEqual(c.levelFromXp(0), { level: 0, into: 0, needed: 100 });
  assert.equal(c.levelFromXp(100).level, 1);
  assert.equal(c.levelFromXp(255).level, 2);
  const r = c.addXp("g", "u", 120, { message: true });
  assert.deepEqual([r.before, r.after], [0, 1]);
  assert.equal(db.prepare("SELECT messages FROM community_levels WHERE guild_id='g' AND user_id='u'").get().messages, 1);
});

test("message XP: once per minute, level-up announced with role rewards", async () => {
  const sent = [];
  const added = [];
  db.prepare("INSERT INTO community_level_config(guild_id,enabled,channel_id,rewards_json) VALUES('g2',1,NULL,'{\"1\":\"r1\"}')").run();
  const member = { id: "m", roles: { cache: new Map(), add: async (roles) => added.push(...roles) } };
  const message = { guild: { id: "g2", roles: { cache: new Map([["r1", { id: "r1", permissions: 0n }]]) } }, author: { id: "m", bot: false }, member, channel: { isTextBased: () => true, send: async (p) => sent.push(p.content) } };
  c.addXp("g2", "m", 90);
  const first = await c.handleLevelMessage(message, { random: () => 0.99, now: 1_000_000 });
  assert.equal(first.after, 1);
  assert.deepEqual(added, ["r1"]);
  assert.match(sent[0], /niveau 1/);
  assert.equal(await c.handleLevelMessage(message, { now: 1_030_000 }), null, "cooldown");
});

test("voice XP needs two humans, not deafened", async () => {
  const mk = (id, extra = {}) => ({ id, user: { bot: false }, voice: {}, roles: { cache: new Map(), add: async () => {} }, ...extra });
  const alone = { id: "v1", isVoiceBased: () => true, members: new Map([["a", mk("a")]]) };
  const duo = { id: "v2", isVoiceBased: () => true, members: new Map([["b", mk("b")], ["d", mk("d", { voice: { selfDeaf: true } })]]) };
  const guild = { id: "g3", afkChannelId: null, channels: { cache: new Map([["v1", alone], ["v2", duo]]) }, roles: { cache: new Map() } };
  assert.equal(await c.tickVoiceXp([guild]), 1);
});

test("durations for reminders", () => {
  assert.equal(c.parseDuration("10m"), 600_000);
  assert.equal(c.parseDuration("1j2h"), 93_600_000);
  assert.equal(c.parseDuration("30s"), null, "minimum 1 minute");
  assert.equal(c.parseDuration("demain"), null);
});

test("reminders are delivered once, by DM when the channel is gone", async () => {
  db.prepare("INSERT INTO community_reminders(guild_id,channel_id,user_id,text,due_at,created_at) VALUES('g','gone','u','boire de l''eau',1,1)").run();
  const dms = [];
  const client = { channels: { fetch: async () => null }, users: { fetch: async () => ({ send: async (p) => dms.push(p.content) }) } };
  assert.equal(await c.runReminders(client, 10), 1);
  assert.match(dms[0], /boire de l'eau/);
  assert.equal(await c.runReminders(client, 10), 0);
});

test("birthdays: wished once at 9:00 Paris, role given then removed the next day", async () => {
  db.prepare("INSERT INTO community_birthdays(guild_id,user_id,day,month) VALUES('gb','x',24,11)").run();
  db.prepare("INSERT INTO community_settings(guild_id,key,value) VALUES('gb','birthday_channel','c'),('gb','birthday_role','br')").run();
  const sent = [];
  const roles = [];
  const member = { roles: { cache: new Map([["br", {}]]), add: async (r) => roles.push(["add", r]), remove: async (r) => roles.push(["remove", r]) } };
  const guild = { id: "gb", roles: { cache: new Map([["br", { id: "br", permissions: 0n }]]) }, members: { fetch: async () => member }, channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => sent.push(p.content) }) } };
  const nineAm = Date.parse("2026-11-24T08:30:00Z");
  assert.equal(await c.runBirthdays([guild], Date.parse("2026-11-24T06:00:00Z")), 0, "before 9:00");
  assert.equal(await c.runBirthdays([guild], nineAm), 1);
  assert.equal(await c.runBirthdays([guild], nineAm + 60_000), 0, "once a day");
  await c.runBirthdays([guild], Date.parse("2026-11-25T08:30:00Z"));
  assert.deepEqual(roles, [["add", "br"], ["remove", "br"]]);
  assert.match(sent[0], /Joyeux anniversaire <@x>/);
});

test("suggestion votes toggle and close", async () => {
  db.prepare("INSERT INTO community_suggestions(id,guild_id,author_id,content,created_at) VALUES(7,'gs','a','Ajouter un salon memes',1)").run();
  const updates = [];
  const click = (dir, user) => ({ isButton: () => true, customId: `sugg:${dir}:7`, guildId: "gs", user: { id: user }, update: async (p) => updates.push(p), reply: async (p) => updates.push(p) });
  await c.handleSuggestionVote(click("up", "u1"));
  await c.handleSuggestionVote(click("up", "u2"));
  await c.handleSuggestionVote(click("up", "u2"));
  await c.handleSuggestionVote(click("down", "u3"));
  const votes = updates.at(-1).embeds[0].data.fields.find((f) => f.name === "Votes").value;
  assert.equal(votes, "👍 1 · 👎 1");
});

test("sécurité : un rôle à permissions sensibles n'est jamais donné en récompense de niveau", async () => {
  db.prepare("INSERT INTO community_level_config(guild_id,enabled,channel_id,rewards_json) VALUES('g-sec',1,NULL,'{\"1\":\"r-admin\"}')").run();
  const added = [];
  const member = { id: "m-sec", roles: { cache: new Map(), add: async (roles) => added.push(...roles) } };
  const roles = new Map([
    ["r-admin", { id: "r-admin", permissions: 1n << 3n }],
    ["r-ok", { id: "r-ok", permissions: 0n }],
  ]);
  const message = { guild: { id: "g-sec", roles: { cache: roles } }, author: { id: "m-sec", bot: false }, member, channel: { isTextBased: () => true, send: async () => {} } };
  c.addXp("g-sec", "m-sec", 90);
  const result = await c.handleLevelMessage(message, { random: () => 0.99, now: 5_000_000 });
  assert.equal(result.after, 1, "le niveau est bien atteint");
  assert.deepEqual(added, [], "rôle Administrateur refusé");
});
