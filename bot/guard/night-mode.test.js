import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionFlagsBits as P } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "fwu-night-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const N = await import("./night-mode.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("plage horaire : avec et sans passage de minuit ; heure de Paris", () => {
  assert.ok(N.inNight(2, 1, 7));
  assert.ok(!N.inNight(7, 1, 7));
  assert.ok(N.inNight(23, 23, 6) && N.inNight(3, 23, 6) && !N.inNight(12, 23, 6));
  assert.equal(N.parisHour(Date.UTC(2026, 10, 27, 0, 30)), 1, "hiver : UTC+1");
  assert.equal(N.parisHour(Date.UTC(2026, 6, 1, 0, 30)), 2, "été : UTC+2");
});

test("réglages : bornes, salons", () => {
  assert.throws(() => N.configureNight("g", { startHour: 24 }), /0 à 23/);
  assert.throws(() => N.configureNight("g", { startHour: 7 }), /différents/);
  const c = N.configureNight("g", { startHour: 23, endHour: 6, slowmode: 60, lock: true, raidThreshold: 5 });
  assert.deepEqual([c.startHour, c.endHour, c.slowmode, c.lock, c.raidThreshold], [23, 6, 60, true, 5]);
  N.addNightChannel("g", "c1");
  N.addNightChannel("g", "c1");
  assert.deepEqual(N.nightConfig("g").channels, ["c1"]);
  assert.deepEqual(N.removeNightChannel("g", "c1").channels, []);
});

function fakeGuild(id) {
  const edits = [];
  const channel = {
    id: "c1", rateLimitPerUser: 5,
    permissionOverwrites: { cache: new Map([["everyone", { allow: { has: () => false }, deny: { has: () => false } }]]), edit: async (_role, perms) => { edits.push(perms); } },
    setRateLimitPerUser: async (n) => { channel.rateLimitPerUser = n; },
  };
  return { id, edits, channel, roles: { everyone: { id: "everyone" } }, channels: { cache: new Map([["c1", channel]]) } };
}

test("passage planifié : applique la nuit, renforce l'anti-raid, puis remet tout comme avant", async () => {
  const guild = fakeGuild("g2");
  const client = { guilds: { cache: new Map([["g2", guild]]) } };
  N.configureNight("g2", { startHour: 1, endHour: 7, slowmode: 30, lock: true, raidThreshold: 4 });
  N.addNightChannel("g2", "c1");
  N.setNightEnabled("g2", true);
  const notes = [];
  const notify = async (_g, text) => notes.push(text);
  const night = Date.UTC(2026, 10, 27, 1, 0); // 2 h à Paris
  const day = Date.UTC(2026, 10, 27, 9, 0); // 10 h à Paris
  assert.equal(N.nightRaidThreshold("g2"), null);
  assert.deepEqual(await N.runNightMode(client, { now: night, notify }), { g2: "on" });
  assert.equal(guild.channel.rateLimitPerUser, 30);
  assert.deepEqual(guild.edits.at(-1), { SendMessages: false });
  assert.equal(N.nightRaidThreshold("g2"), 4);
  assert.deepEqual(await N.runNightMode(client, { now: night + 60_000, notify }), {}, "déjà active");
  assert.deepEqual(await N.runNightMode(client, { now: day, notify }), { g2: "off" });
  assert.equal(guild.channel.rateLimitPerUser, 5, "mode lent d'avant");
  assert.deepEqual(guild.edits.at(-1), { SendMessages: null }, "permission d'avant (neutre)");
  assert.equal(N.nightRaidThreshold("g2"), null);
  assert.equal(notes.length, 2);
  N.setNightEnabled("g2", false);
  assert.deepEqual(await N.runNightMode(client, { now: night }), {}, "désactivé");
});
