import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-tempban-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
process.env.PND_OWNER_DISCORD_ID = "100000000000000009";
const T = await import("./tempban.js");
const { runModerationAction } = await import("../moderation-actions.js");
const { recordModerationCase, discardModerationCase, liftSanctionAfterAppeal } = await import("../moderation.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });
const G = "100000000000000001";

test("durée du ban temporaire : formats courants, 1 minute à 365 jours", () => {
  assert.equal(T.parseTempbanDuration("7j").seconds, 7 * 86_400);
  assert.equal(T.parseTempbanDuration("1h30").seconds, 5_400);
  assert.equal(T.parseTempbanDuration("45").seconds, 45 * 60);
  assert.match(T.parseTempbanDuration("30s").error, /trop courte/);
  assert.match(T.parseTempbanDuration("400j").error, /trop longue/);
  assert.match(T.parseTempbanDuration("bientôt").error, /invalide/);
  assert.match(T.parseTempbanDuration(undefined).error, /invalide/);
});

test("à l'échéance le membre est débanni ; un échec Discord est réessayé puis abandonné", async () => {
  const removed = [];
  let refuse = false;
  const guild = { id: G, bans: { remove: async (id) => { if (refuse) throw Object.assign(new Error("x"), { code: 50013 }); removed.push(id); } } };
  T.scheduleTempban({ guildId: G, userId: "u1", seconds: 60, caseId: 4, moderatorId: "m", now: 0 });
  T.scheduleTempban({ guildId: G, userId: "u2", seconds: 3_600, moderatorId: "m", now: 0 });
  const lifted = [];
  assert.equal(await T.expireTempbans({ guildFor: () => guild, onLifted: (_g, row) => lifted.push(row.user_id), now: 61_000 }), 1);
  assert.deepEqual(removed, ["u1"]);
  assert.deepEqual(lifted, ["u1"]);
  assert.equal(T.getTempban(G, "u1"), null);
  assert.ok(T.getTempban(G, "u2"), "pas encore échu");
  assert.equal(await T.expireTempbans({ guildFor: () => null, now: 4_000_000 }), 0, "serveur injoignable : on attend");
  assert.ok(T.getTempban(G, "u2"));
  refuse = true;
  const failed = [];
  let now = 4_000_000;
  for (let i = 0; i < 5; i += 1) { await T.expireTempbans({ guildFor: () => guild, onFailed: (_g, row) => failed.push(row.user_id), now }); now += 10 * 60_000; }
  assert.deepEqual(failed, ["u2"]);
  assert.equal(T.getTempban(G, "u2"), null);
});

test("déjà débanni à la main (10026) : l'échéance disparaît sans erreur", async () => {
  T.scheduleTempban({ guildId: G, userId: "u3", seconds: 60, moderatorId: "m", now: 0 });
  const guild = { id: G, bans: { remove: async () => { throw Object.assign(new Error("Unknown Ban"), { code: 10026 }); } } };
  await T.expireTempbans({ guildFor: () => guild, now: 120_000 });
  assert.equal(T.getTempban(G, "u3"), null);
  assert.equal(T.clearTempban(G, "u3"), false);
});

function fakeGuild(order, { banFails = false } = {}) {
  return {
    id: G, name: "Serveur", ownerId: "100000000000000099",
    client: { user: { id: "100000000000000098" } },
    members: { me: null, fetchMe: async () => ({}) },
    channels: { cache: new Map() },
    ban: async () => { order.push("ban"); if (banFails) throw Object.assign(new Error("perm"), { code: 50013 }); },
  };
}
const owner = { id: "100000000000000009", guild: { id: G }, permissions: { has: () => true }, roles: { cache: new Map() } };

test("ban : le MP avec le bouton d'appel part AVANT le ban ; ban refusé = MP retiré et dossier effacé", async () => {
  const order = [];
  let deleted = false;
  const user = { id: "100000000000000005", tag: "x#0", send: async (payload) => { order.push(payload.components.length ? "dm+appel" : "dm"); return { delete: async () => { deleted = true; } }; } };
  const guild = fakeGuild(order);
  const { caseId } = await runModerationAction({ guild, actor: owner, command: "ban", bot: "guard", targetId: user.id, targetUser: user, reason: "test", durationSeconds: 3_600,
    recordCase: recordModerationCase, discardCase: discardModerationCase, appealButton: () => ({ type: 1, components: [] }), execute: () => guild.ban() });
  assert.deepEqual(order, ["dm+appel", "ban"]);
  assert.ok(caseId);
  const failing = fakeGuild(order.splice(0), { banFails: true });
  await assert.rejects(runModerationAction({ guild: failing, actor: owner, command: "ban", bot: "guard", targetId: user.id, targetUser: user, reason: "test",
    recordCase: recordModerationCase, discardCase: discardModerationCase, appealButton: () => ({ type: 1, components: [] }), execute: () => failing.ban() }), /Permission/);
  assert.equal(deleted, true, "le MP annoncé est retiré");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id = ?").get(G).n, 1, "le dossier du ban raté est effacé");
});

test("appel accepté : le ban (et son échéance) ou l'exclusion en cours sont levés", async () => {
  const removed = [];
  T.scheduleTempban({ guildId: G, userId: "a1", seconds: 3_600, moderatorId: "m" });
  const guild = { id: G, bans: { remove: async (id) => removed.push(id) }, members: { fetch: async () => ({ communicationDisabledUntilTimestamp: Date.now() + 60_000, timeout: async (v) => removed.push(`timeout:${v}`) }) } };
  assert.match(await liftSanctionAfterAppeal(guild, { id: 1, case_id: 2, action: "ban", appellant_id: "a1" }), /Ban levé/);
  assert.equal(T.getTempban(G, "a1"), null);
  assert.match(await liftSanctionAfterAppeal(guild, { id: 2, case_id: 3, action: "mute", appellant_id: "a2" }), /Exclusion temporaire levée/);
  assert.deepEqual(removed, ["a1", "timeout:null"]);
  assert.match(await liftSanctionAfterAppeal(guild, { id: 3, case_id: 4, action: "warn", appellant_id: "a3" }), /Rien à lever/);
  assert.match(await liftSanctionAfterAppeal(null, { id: 4, case_id: 5, action: "ban", appellant_id: "a4" }), /à la main/);
});
