import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-fwuplus-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const m = await import("./fwu-plus.js");
const { db } = await import("../database.js");

test("fwu-plus helpers", async (context) => {
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(m.validTimeZone("Europe/Paris"), true);
  assert.equal(m.validTimeZone("Mars/Olympus"), false);
  assert.equal(m.validTimeZone("Europe/Paris; rm"), false);
  assert.match(m.localTime("Europe/Paris", Date.UTC(2026, 0, 1, 12)), /13:00/);
  assert.equal(m.transcript([{ createdTimestamp: Date.UTC(2026, 0, 1), author: { username: "a" }, content: "salut\nça va", attachments: new Map() }]), "[2026-01-01 00:00] a: salut ça va");
  assert.deepEqual(m.redactSecrets({ logs: { webhookUrl: "https://discord.com/api/webhooks/1/x" }, ai: { apiKey: "k" }, name: "ok", list: ["https://discord.com/api/webhooks/2/y"] }), { logs: { webhookUrl: "[retiré]" }, ai: { apiKey: "[retiré]" }, name: "ok", list: ["[retiré]"] });
  const lines = m.healthLines([{ domain: "guard", expiresAt: Date.now() + 10_000 }], [{ profile: "fisc", failures: 3 }]);
  assert.ok(lines.some((l) => l.startsWith("GUARD : 🟢")));
  assert.ok(lines.some((l) => l.startsWith("LE FISC : 🔴") && l.includes("3 échec")));
  assert.equal(m.isPublicChannel({ guild: { roles: { everyone: {} } }, permissionsFor: () => ({ has: () => false }) }), false);

  // Défi collectif
  const week = m.weekNumber();
  db.prepare("INSERT INTO weekly_challenge(guild_id, week, goal, progress, reward, done) VALUES ('g', ?, 2, 0, 50, 0)").run(week);
  assert.equal(m.countChallengeMessage("g", "u1"), null);
  const done = m.countChallengeMessage("g", "u2");
  assert.equal(done.done, 1);
  assert.equal(m.countChallengeMessage("g", "u3"), null, "déjà réussi");
  const paid = [];
  await m.payChallenge({ id: "g", systemChannel: { send: async () => {} }, channels: { fetch: async () => null } }, { ...done, week }, (g, u, amount) => paid.push([u, amount]));
  assert.deepEqual(paid.sort(), [["u1", 50], ["u2", 50]]);
  assert.deepEqual(m.challengeProgress({ progress: 5, goal: 10, done: 0 }).pct, 50);

  // Boost
  const grants = [];
  assert.equal(await m.handleBoost({ premiumSinceTimestamp: null }, { id: "b", premiumSinceTimestamp: 1, guild: { id: "g", systemChannel: null } }, { grant: (...a) => grants.push(a) }), true);
  assert.deepEqual(grants, [["g", "b", 500, "boost_merci"]]);
  assert.equal(await m.handleBoost({ premiumSinceTimestamp: 1 }, { premiumSinceTimestamp: 1 }, { grant: () => {} }), false);
});
