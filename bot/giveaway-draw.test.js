import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-giveaway-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const draw = await import("./giveaway-draw.js");
const { handleGamesMessage } = await import("./games.js");
const { db } = await import("./database.js");

const g = "820000000000000001";
const host = "820000000000000002";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

test("the seeded draw is deterministic and depends on the seed", () => {
  const participants = Array.from(
    { length: 30 },
    (_, i) => `u${String(i).padStart(2, "0")}`,
  );
  const seed = "ab".repeat(32);
  const a = draw.computeDraw({ participants, count: 3, seed });
  const b = draw.computeDraw({
    participants: [...participants].reverse(),
    count: 3,
    seed,
  });
  assert.deepEqual(a, b, "participant order does not matter");
  assert.notDeepEqual(
    a,
    draw.computeDraw({ participants, count: 3, seed: "cd".repeat(32) }),
  );
  assert.equal(new Set(a).size, 3);
});

function seedGiveaway(id, entries) {
  db.prepare(
    `INSERT INTO giveaways(giveaway_id,guild_id,channel_id,message_id,prize,host_id,ends_at,winner_count,status,created_at)
    VALUES(?,?,?,NULL,'Nitro',?,0,2,'open',0)`,
  ).run(id, g, "c", host);
  for (const user of entries)
    db.prepare(
      "INSERT INTO giveaway_entries(giveaway_id,user_id,created_at) VALUES(?,?,0)",
    ).run(id, user);
}

function msg(content) {
  const replies = [];
  return {
    replies,
    guild: { id: g, ownerId: host },
    member: { permissions: { has: () => false } },
    author: { id: host },
    content,
    channel: {
      id: "c",
      isTextBased: () => true,
      send: async (p) => replies.push(p),
      messages: { fetch: async () => null },
    },
    mentions: { users: { first: () => null } },
    reply: async (p) => {
      replies.push(p);
    },
  };
}

test("ending stores a replayable draw; verification passes, then detects tampering", async () => {
  seedGiveaway("gw000001", [
    "820000000000000011",
    "820000000000000012",
    "820000000000000013",
    "820000000000000014",
  ]);
  await handleGamesMessage(msg("=giveaway end gw000001"));
  const [first] = draw.listDraws("gw000001", g);
  assert.equal(first.kind, "draw");
  assert.equal(first.winners.length, 2);
  assert.equal(first.seed.length, 64);
  assert.ok(
    draw
      .verifyGiveaway("gw000001", g, 2)
      .every((r) => r.participantsMatch && r.winnersMatch),
  );
  const check = msg("=giveaway verifier gw000001");
  await handleGamesMessage(check);
  assert.match(JSON.stringify(check.replies), /✅ Tirage/);
  db.prepare(
    "INSERT INTO giveaway_entries(giveaway_id,user_id,created_at) VALUES('gw000001','820000000000000099',0)",
  ).run();
  assert.equal(
    draw.verifyGiveaway("gw000001", g, 2)[0].participantsMatch,
    false,
  );
});

test("reroll excludes previous winners and is itself logged", async () => {
  seedGiveaway("gw000002", [
    "820000000000000021",
    "820000000000000022",
    "820000000000000023",
  ]);
  await handleGamesMessage(msg("=giveaway end gw000002"));
  const reroll = msg("=giveaway reroll gw000002 1");
  await handleGamesMessage(reroll);
  const draws = draw.listDraws("gw000002", g);
  assert.equal(draws.length, 2);
  assert.equal(draws[1].kind, "reroll");
  assert.equal(draws[0].winners.includes(draws[1].winners[0]), false);
  assert.equal(draws[1].actorId, host);
  const again = msg("=giveaway reroll gw000002 1");
  await handleGamesMessage(again);
  assert.match(JSON.stringify(again.replies), /Plus aucun participant/);
});

test("reroll is refused on an open giveaway", async () => {
  seedGiveaway("gw000003", ["820000000000000031"]);
  const m = msg("=giveaway reroll gw000003");
  await handleGamesMessage(m);
  assert.match(JSON.stringify(m.replies), /après la fin/);
});
