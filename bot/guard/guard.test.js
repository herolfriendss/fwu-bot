import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-guard-")), "db.sqlite");
process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
const { createNukeTracker, isExempt, getAntiNukeConfig, saveAntiNukeConfig, registerBotIdentity, fwuBotIds, createAntiNuke } = await import("./anti-nuke.js");
const { detectViolation, getAutomodConfig, saveAutomodConfig, createFloodTracker, isAutomodExempt, createAutomod } = await import("./automod.js");
const { handleGuardInteraction } = await import("./commands.js");
const { db } = await import("../database.js");

test("anti-nuke: threshold inside the window, exemptions, defaults", () => {
  let t = 0;
  const tracker = createNukeTracker(() => t);
  const cfg = { threshold: 3, windowSeconds: 60 };
  assert.equal(tracker.hit("g", "x", 1, cfg).triggered, false);
  t = 1000; assert.equal(tracker.hit("g", "x", 2, cfg).triggered, false);
  t = 70_000; assert.equal(tracker.hit("g", "x", 3, cfg).triggered, false, "old events expire");
  t = 71_000; tracker.hit("g", "x", 4, cfg);
  t = 72_000; const r = tracker.hit("g", "x", 5, cfg);
  assert.equal(r.triggered, true);
  assert.deepEqual(r.recent, [3, 4, 5]);
  const ctx = { guildOwnerId: "go", ownerId: "100000000000000001", trusted: ["tr"], botIds: new Set(["fwubot"]), selfId: "me" };
  for (const id of ["go", "100000000000000001", "tr", "fwubot", "me"]) assert.equal(isExempt(id, ctx), true, id);
  assert.equal(isExempt("attacker", ctx), false);
  assert.deepEqual(getAntiNukeConfig("new"), { enabled: true, threshold: 3, windowSeconds: 60, trusted: [] });
  assert.equal(saveAntiNukeConfig("new", { threshold: 99, windowSeconds: 1 }, "a").threshold, 20);
  registerBotIdentity("fdpdlavoc", "555555555555555555");
  assert.ok(fwuBotIds().has("555555555555555555"));
});

test("anti-nuke: an attacker deleting channels is neutralised and the channels are restored", async () => {
  const created = [];
  const removed = [];
  const dangerous = { id: "dr", position: 5, managed: false, permissions: { has: () => true } };
  const attacker = { id: "666666666666666666", user: { bot: false }, roles: { cache: new Map([["dr", dangerous]]), remove: async (roles) => removed.push(...roles.map((r) => r.id)) } };
  const guild = {
    id: "g2", ownerId: "go",
    members: { me: { roles: { highest: { position: 50 } } }, fetch: async () => attacker },
    fetchAuditLogs: async () => ({ entries: new Map([["e", { target: { id: "any" }, targetId: null, createdTimestamp: Date.now(), executor: { id: attacker.id } }]]) }),
    channels: { create: async (o) => created.push(o.name) },
  };
  const reports = [];
  const nuke = createAntiNuke({ client: { user: { id: "me" } }, report: async (_g, e) => reports.push(e) });
  const channel = (id, name) => ({ id, name, type: 0, guild, parentId: null, permissionOverwrites: { cache: new Map() } });
  guild.fetchAuditLogs = async () => ({ entries: new Map(["1", "2", "3"].map((id) => [id, { targetId: id, createdTimestamp: Date.now(), executor: { id: attacker.id } }])) });
  await nuke.channelDelete(channel("1", "général"));
  await nuke.channelDelete(channel("2", "annonces"));
  assert.equal(reports.length, 0);
  await nuke.channelDelete(channel("3", "règlement"));
  assert.deepEqual(removed, ["dr"]);
  assert.deepEqual(created.sort(), ["annonces", "général", "règlement"]);
  assert.match(reports[0].description, /rôle\(s\) dangereux retiré/);
});

test("automod: detection, flood, exemptions", () => {
  const cfg = getAutomodConfig("g");
  assert.equal(cfg.rules.invitations.enabled, true);
  assert.equal(detectViolation("rejoins discord.gg/abc123", cfg), "invitations");
  assert.equal(detectViolation("https://example.com", cfg), null, "links off by default");
  const on = saveAutomodConfig("g", { ...cfg, words: ["Gros Mot"], rules: { ...cfg.rules, liens: { enabled: true }, mots: { enabled: true }, majuscules: { enabled: true } } }, "a");
  assert.equal(detectViolation("va voir https://x.y", on), "liens");
  assert.equal(detectViolation("t'es un gros mot toi", on), "mots");
  assert.equal(detectViolation("JE CRIE TRES FORT ICI", on), "majuscules");
  assert.equal(detectViolation("Bonjour à tous", on), null);
  let t = 0;
  const flood = createFloodTracker({ now: () => t });
  for (let i = 0; i < 4; i += 1) assert.equal(flood("g", "u"), false);
  assert.equal(flood("g", "u"), true);
  const member = (perms = [], roles = []) => ({ id: "u", guild: { ownerId: "go" }, permissions: { has: (f) => perms.includes(f) }, roles: { cache: new Map(roles.map((r) => [r, {}])) } });
  assert.equal(isAutomodExempt(member(), "c", on), false);
  assert.equal(isAutomodExempt(member([8192n]), "c", on), true);
  assert.equal(isAutomodExempt(member([], ["sys"]), "c", on, "sys"), true);
});

test("automod deletes the message, warns and records a case", async () => {
  const g = "g3";
  const cfg = getAutomodConfig(g);
  saveAutomodConfig(g, { ...cfg, rules: { ...cfg.rules, invitations: { enabled: true, action: "avertir" } } }, "a");
  let deleted = false;
  const message = {
    guild: { id: g }, author: { id: "u1", bot: false }, channelId: "c", content: "discord.gg/pub",
    member: { id: "u1", guild: { ownerId: "go" }, permissions: { has: () => false }, roles: { cache: new Map() } },
    client: { user: { id: "guardbot" } }, delete: async () => { deleted = true; }, channel: { send: async () => null },
  };
  assert.equal(await createAutomod()(message, {}), "invitations");
  assert.equal(deleted, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM moderation_warnings WHERE guild_id=?").get(g).n, 1);
  assert.equal(db.prepare("SELECT action FROM moderation_cases WHERE guild_id=?").get(g).action, "automod_avertir");
});

function slash(commandName, sub, { member, options = {}, guild } = {}) {
  const replies = [];
  return {
    replies,
    i: {
      isChatInputCommand: () => true, commandName, guild, member, user: { id: member.id },
      options: {
        getSubcommand: () => sub, getUser: (n) => options[n] ?? null, getString: (n) => options[n] ?? null,
        getInteger: (n) => options[n] ?? null, getChannel: (n) => options[n] ?? null, getRole: (n) => options[n] ?? null,
      },
      deferReply: async () => {}, editReply: async (p) => replies.push(p), reply: async (p) => replies.push(p),
    },
  };
}

test("/antinuke settings are reserved to the OWNER / server owner", async () => {
  const guild = { id: "g4", ownerId: "go" };
  const staff = { id: "s", guild, permissions: { has: () => true }, roles: { cache: new Map() } };
  let r = slash("antinuke", "desactiver", { member: staff, guild });
  await handleGuardInteraction(r.i, {});
  assert.match(r.replies[0].content, /Seuls l'OWNER/);
  r = slash("antinuke", "desactiver", { member: { ...staff, id: "go" }, guild });
  await handleGuardInteraction(r.i, {});
  assert.match(r.replies[0].content, /désactivé/);
});

test("/quarantaine sets roles aside and gives them back", async () => {
  const added = [];
  const removed = [];
  const roles = new Map([["r1", { id: "r1", position: 3, managed: false }], ["q", { id: "q", position: 2, managed: false }]]);
  const target = { id: "t", voice: {}, roles: { cache: new Map([["r1", roles.get("r1")]]), add: async (x) => added.push(x), remove: async (x) => removed.push(x) } };
  const guild = { id: "g5", ownerId: "go", members: { me: { roles: { highest: { position: 10 } } }, fetch: async () => target }, roles: { cache: roles, fetch: async (id) => roles.get(id) } };
  const mod = { id: "go", guild, permissions: { has: () => true }, roles: { cache: new Map() } };
  const settings = { guildGuard: { quarantineRoleId: "q" } };
  let r = slash("quarantaine", "ajouter", { member: mod, guild, options: { membre: { id: "t" } } });
  await handleGuardInteraction(r.i, settings);
  assert.match(r.replies[0].content, /en quarantaine \(1 rôle/);
  r = slash("quarantaine", "retirer", { member: mod, guild, options: { membre: { id: "t" } } });
  target.roles.cache.set("q", roles.get("q"));
  await handleGuardInteraction(r.i, settings);
  assert.match(r.replies[0].content, /1 rôle\(s\) rendu/);
  assert.deepEqual(added.at(-1), ["r1"]);
});
