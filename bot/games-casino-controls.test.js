import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-games-casino-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const { handleGamesMessage } = await import("./games.js");
const { grantPnd, pndBalance } = await import("./economy.js");
const { setCasinoSelfExclusion, setCasinoDailyWagerLimit } =
  await import("./casino.js");
const { db } = await import("./database.js");

const g = "810000000000000001";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

function message(uid, content) {
  const replies = [];
  return {
    replies,
    guild: { id: g },
    guildId: g,
    member: { permissions: { has: () => false } },
    author: { id: uid },
    content,
    channel: { id: "c" },
    mentions: { users: { first: () => null } },
    reply: async (p) => {
      replies.push(p);
    },
  };
}

test("a self-excluded member can no longer wager on coinflip", async () => {
  const uid = "810000000000000002";
  grantPnd(g, uid, 1_000, "test");
  setCasinoSelfExclusion({ guildId: g, userId: uid, durationMs: 86_400_000 });
  const m = message(uid, "=coinflip 100 pile");
  await handleGamesMessage(m);
  assert.match(JSON.stringify(m.replies), /auto-exclusion/);
  assert.equal(pndBalance(g, uid).balance, 1_000);
});

test("coinflip bets count toward and respect the daily wager limit", async () => {
  const uid = "810000000000000003";
  grantPnd(g, uid, 10_000, "test");
  setCasinoDailyWagerLimit({ guildId: g, userId: uid, limit: 150 });
  await handleGamesMessage(message(uid, "=coinflip 100 pile"));
  const second = message(uid, "=coinflip 100 face");
  await handleGamesMessage(second);
  assert.match(JSON.stringify(second.replies), /limite quotidienne/);
});

test("regression: =coinflip actually resolves (it used to crash with 'random is not a function')", async () => {
  const uid = "810000000000000004";
  grantPnd(g, uid, 1_000, "test");
  const m = message(uid, "=coinflip 100 pile");
  await handleGamesMessage(m);
  assert.match(JSON.stringify(m.replies), /gagné|perdu/);
  assert.notEqual(pndBalance(g, uid).balance, 1_000);
});
