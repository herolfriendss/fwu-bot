import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-invites-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const R = await import("./invite-rewards.js");
const { recordMemberInvite } = await import("../invite-attribution.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 27);
const OLD = NOW - 400 * DAY;

test("décision : présent 7 jours, compte ancien, inviteur présent, plafond", () => {
  const row = { guild_id: "g", user_id: "b", inviter_id: "a", joined_at: NOW - 7 * DAY };
  const ok = { invitee: { present: true, bot: false, createdTimestamp: OLD }, inviterPresent: true, paidRecently: 0 };
  assert.deepEqual(R.decideInvite(row, ok), { status: "paid", reason: null });
  assert.equal(R.decideInvite(row, { ...ok, invitee: { ...ok.invitee, present: false } }).reason, "parti avant 7 jours");
  assert.equal(R.decideInvite(row, { ...ok, invitee: { ...ok.invitee, bot: true } }).reason, "bot");
  assert.equal(R.decideInvite(row, { ...ok, invitee: { ...ok.invitee, createdTimestamp: row.joined_at - 3 * DAY } }).reason, "compte trop récent");
  assert.equal(R.decideInvite(row, { ...ok, inviterPresent: false }).reason, "inviteur parti");
  assert.equal(R.decideInvite(row, { ...ok, paidRecently: R.INVITE_REWARD.weeklyCap }).reason, "plafond hebdomadaire");
  assert.equal(R.decideInvite({ ...row, user_id: "a" }, ok).reason, "soi-même");
});

function fakeClient({ members = {}, users = {} } = {}) {
  const guild = { id: "g1", members: { fetch: async (id) => members[id] ?? Promise.reject(new Error("absent")) } };
  return { guilds: { cache: new Map([["g1", guild]]) }, users: { fetch: async (id) => users[id] ?? null } };
}

test("tâche : paie une seule fois, ignore les arrivées trop récentes ou anciennes, refus enregistrés", async () => {
  recordMemberInvite("g1", "b", { source: "invite", inviterId: "a", code: "x" }, NOW - 7 * DAY - 1);
  recordMemberInvite("g1", "c", { source: "invite", inviterId: "a", code: "x" }, NOW - 7 * DAY - 2);
  recordMemberInvite("g1", "d", { source: "invite", inviterId: "a", code: "x" }, NOW - 2 * DAY);
  recordMemberInvite("g1", "e", { source: "invite", inviterId: "a", code: "x" }, NOW - 60 * DAY);
  recordMemberInvite("g1", "f", { source: "vanity", inviterId: null, code: null }, NOW - 7 * DAY - 3);
  const member = (id, created = OLD) => ({ id, user: { id, bot: false, createdTimestamp: created } });
  const client = fakeClient({ members: { a: member("a"), b: member("b") } });
  const before = Number(db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM economy_ledger WHERE guild_id='g1' AND user_id='a' AND reason='invite_reward'").get().n);
  assert.equal(await R.runInviteRewards(client, { now: NOW }), 1);
  assert.equal(await R.runInviteRewards(client, { now: NOW + 1 }), 0, "jamais payé deux fois");
  const after = Number(db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM economy_ledger WHERE guild_id='g1' AND user_id='a' AND reason='invite_reward'").get().n);
  assert.equal(after - before, R.INVITE_REWARD.amount);
  const s = R.inviteStats("g1", "a", NOW);
  assert.deepEqual(s, { paid: 1, earned: R.INVITE_REWARD.amount, rejected: 1, pending: 1 });
  assert.deepEqual(R.inviteLeaderboard("g1"), [{ inviterId: "a", count: 1, earned: R.INVITE_REWARD.amount }]);
  assert.equal(await R.runInviteRewards(client, { now: NOW, isAllowedGuild: () => false }), 0);
});
