import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-social-rep-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const { handleSocialMessage } = await import("./social.js");
const { computeBadges, evaluateRepGiver } = await import("./social-policy.js");
const { db } = await import("./database.js");

const DAY = 86_400_000;
const now = Date.now();
const g = "840000000000000001";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

test("giver age and daily cap", () => {
  const old = {
    accountCreatedAt: now - 400 * DAY,
    joinedAt: now - 100 * DAY,
    now,
  };
  assert.equal(evaluateRepGiver({ ...old }).allowed, true);
  assert.equal(
    evaluateRepGiver({ ...old, accountCreatedAt: now - DAY }).allowed,
    false,
  );
  assert.equal(evaluateRepGiver({ ...old, joinedAt: NaN }).allowed, false);
  assert.equal(evaluateRepGiver({ ...old, givenLast24h: 5 }).allowed, false);
});

test("badges are computed from guild data", () => {
  const badges = computeBadges({
    rep: 60,
    joinedAt: now - 400 * DAY,
    totalPnd: 150_000,
    cards: 30,
    givenTotal: 0,
    now,
  });
  assert.deepEqual(badges, [
    "⭐ Vétéran",
    "🎂 Ancien (1 an)",
    "💰 Fortuné",
    "🎴 Collectionneur",
  ]);
  assert.deepEqual(computeBadges({ rep: 0, now }), ["🌱 Nouveau"]);
});

function repMessage(
  giver,
  target,
  { createdAt = now - 400 * DAY, joinedAt = now - 100 * DAY } = {},
) {
  const replies = [];
  return {
    replies,
    guild: { id: g },
    member: { joinedTimestamp: joinedAt },
    author: { id: giver, createdTimestamp: createdAt },
    content: `=rep <@${target}> merci`,
    mentions: { users: { first: () => ({ id: target, bot: false }) } },
    reply: async (p) => {
      replies.push(p);
    },
  };
}
const count = (giver) =>
  db.prepare("SELECT COUNT(*) c FROM reputation WHERE giver_id=?").get(giver).c;

test("=rep refuses young accounts and caps a giver at 5 per day across targets", async () => {
  const young = repMessage("840000000000000010", "840000000000000020", {
    createdAt: now - DAY,
  });
  await handleSocialMessage(young);
  assert.match(JSON.stringify(young.replies), /compte Discord/);
  assert.equal(count("840000000000000010"), 0);
  const giver = "840000000000000011";
  for (let i = 0; i < 6; i += 1)
    await handleSocialMessage(repMessage(giver, `84000000000000003${i}`));
  assert.equal(count(giver), 5);
});

test("same target twice is refused by the cooldown; history lists received points", async () => {
  const giver = "840000000000000012";
  await handleSocialMessage(repMessage(giver, "840000000000000040"));
  const again = repMessage(giver, "840000000000000040");
  await handleSocialMessage(again);
  assert.match(
    JSON.stringify(again.replies),
    /Réputation déjà donnée|redonner/,
  );
  const replies = [];
  await handleSocialMessage({
    guild: { id: g },
    member: {},
    author: { id: "x" },
    content: "=rep historique <@840000000000000040>",
    mentions: {
      users: { first: () => ({ id: "840000000000000040", username: "cible" }) },
    },
    reply: async (p) => replies.push(p),
  });
  assert.match(JSON.stringify(replies), /Total : \*\*1\*\*/);
});
