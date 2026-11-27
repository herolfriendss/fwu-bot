import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-garde-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { astreinteMembers, expireFrozenChannels, handleGardeInteraction, staffSummary } = await import("./commands.js");
const { db } = await import("../../database.js");

test("/garde moi, releve, astreinte, geler then automatic reopening", async (context) => {
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const now = Date.now();
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES ('g','m','sys','warn','spam',?)").run(now - 1000);
  assert.equal(staffSummary("g", "sys").day.length, 1);
  const overwrites = [];
  const everyone = { id: "g" };
  const channel = { id: "c", guild: null, rateLimitPerUser: 0, permissionOverwrites: { cache: new Map(), edit: async (role, value) => overwrites.push(value) }, setRateLimitPerUser: async () => {}, permissionsFor: () => ({ has: () => true }), send: async () => {} };
  const sys = { id: "sys", roles: { cache: { has: (r) => r === "sys-role" }, highest: { position: 5 } }, permissions: { has: () => true } };
  const guild = { id: "g", name: "Test", roles: { everyone }, channels: { fetch: async () => channel }, members: { me: {}, fetch: async () => sys } };
  sys.guild = guild; channel.guild = guild;
  const replies = [];
  const run = (sub, opts = {}) => handleGardeInteraction({
    isChatInputCommand: () => true, inGuild: () => true, commandName: "garde", guild, channel, user: { id: "sys" }, client: { users: { fetch: async () => null } },
    options: { getSubcommand: () => sub, getInteger: (n) => opts[n] ?? null, getString: (n) => opts[n] ?? null, getUser: () => ({ id: "m" }), getChannel: () => null },
    deferReply: async () => {}, editReply: async (p) => replies.push(p.content), reply: async () => {},
  }, { sysPlus: { roleId: "sys-role" } });
  await run("moi");
  assert.match(replies.at(-1), /Sanctions 24 h : 1 \(warn ×1\)/);
  await run("releve", { heures: 2 });
  assert.match(replies.at(-1), /Sanctions : 1/);
  await run("astreinte", { etat: "on" });
  assert.deepEqual(astreinteMembers("g"), ["sys"]);
  await run("geler", { minutes: 1 });
  assert.deepEqual(overwrites.at(-1), { SendMessages: false });
  db.prepare("UPDATE garde_frozen_channels SET until=0").run();
  assert.equal(await expireFrozenChannels({ guilds: { cache: new Map([["g", guild]]) } }), 1);
  assert.deepEqual(overwrites.at(-1), { SendMessages: null }, "permission d'origine rendue");
});
