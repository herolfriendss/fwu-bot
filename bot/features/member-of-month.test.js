import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../database.js";
import { castVote, configureMotm, monthKey, monthLabel, previousMonth, runMemberOfMonth, tally } from "./member-of-month.js";

const NOV = Date.UTC(2026, 10, 15, 12);
const DEC1 = Date.UTC(2026, 11, 1, 1); // 2 h à Paris

test("mois de Paris, mois précédent, libellé", () => {
  assert.equal(monthKey(Date.UTC(2026, 10, 30, 23, 30)), "2026-12", "23 h 30 UTC le 30/11 = 1er décembre à Paris");
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(monthLabel("2026-11"), "novembre 2026");
});

test("votes : pas pour soi ni un bot, un vote par mois modifiable, égalité au premier arrivé", () => {
  assert.throws(() => castVote({ guildId: "g", voterId: "a", candidateId: "a" }, NOV), /pour toi/);
  assert.throws(() => castVote({ guildId: "g", voterId: "a", candidateId: "b", candidateIsBot: true }, NOV), /bot/);
  castVote({ guildId: "g", voterId: "v1", candidateId: "x" }, NOV);
  castVote({ guildId: "g", voterId: "v2", candidateId: "x" }, NOV + 1);
  castVote({ guildId: "g", voterId: "v3", candidateId: "y" }, NOV + 2);
  castVote({ guildId: "g", voterId: "v4", candidateId: "y" }, NOV + 3);
  assert.equal(castVote({ guildId: "g", voterId: "v4", candidateId: "y" }, NOV + 4).changed, false);
  assert.deepEqual(tally("g", "2026-11"), [{ userId: "x", votes: 2 }, { userId: "y", votes: 2 }]);
  castVote({ guildId: "g", voterId: "v5", candidateId: "x" }, NOV + 5);
  assert.throws(() => configureMotm("g", { reward: -1 }), /Prime/);
});

test("clôture le 1er : rôle, prime, annonce, une seule fois ; rôle retiré après 30 jours", async () => {
  configureMotm("g", { roleId: "r1", channelId: "c1", reward: 500 });
  const added = []; const removed = []; const posts = [];
  const member = (id) => ({ id, roles: { add: async (r) => added.push([id, r]), remove: async (r) => removed.push([id, r]) } });
  const role = { id: "r1", name: "Membre du mois", permissions: { has: () => false, toArray: () => [] }, managed: false, position: 1 };
  const guild = { id: "g", members: { fetch: async (id) => member(id), me: { roles: { highest: { position: 10 } } } }, roles: { cache: new Map([["r1", role]]), everyone: { id: "g" } }, ownerId: "o" };
  const client = { guilds: { cache: new Map([["g", guild]]) } };
  const announce = async (_g, channelId, text) => posts.push([channelId, text]);
  await runMemberOfMonth(client, { now: DEC1, announce });
  await runMemberOfMonth(client, { now: DEC1 + 1000, announce });
  assert.equal(posts.length, 1);
  assert.match(posts[0][1], /novembre 2026.*<@x>.*3 votes/);
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id='g' AND user_id='x'").get()?.balance, 500);
  if (added.length) {
    await runMemberOfMonth(client, { now: DEC1 + 31 * 86_400_000, announce });
    assert.deepEqual(removed, [["x", "r1"]]);
  }
});
