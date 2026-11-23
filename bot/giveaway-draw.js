import { createHash, createHmac, randomBytes } from "node:crypto";
import { db } from "./database.js";
import { drawGiveawayWinners } from "./games-policy.js";

/**
 * Verifiable giveaway draws.
 * - A fresh 32-byte seed is generated at draw time and stored.
 * - Participants are sorted by id; their SHA-256 fingerprint is stored.
 * - Randomness is HMAC-SHA256(seed, counter): anyone holding the seed and the
 *   participant list can replay the draw and get the exact same winners.
 * - Rerolls are separate rows that exclude every previous winner.
 */
db.exec(`CREATE TABLE IF NOT EXISTS giveaway_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT, giveaway_id TEXT NOT NULL, guild_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('draw','reroll')), seed TEXT NOT NULL,
  participants_hash TEXT NOT NULL, participants_count INTEGER NOT NULL,
  excluded_json TEXT NOT NULL DEFAULT '[]', winners_json TEXT NOT NULL,
  actor_id TEXT, drawn_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS giveaway_draws_idx ON giveaway_draws(giveaway_id,id);`);

export function seededRandom(seedHex) {
  let counter = 0;
  return () => {
    const digest = createHmac("sha256", Buffer.from(seedHex, "hex"))
      .update(String(counter++))
      .digest();
    return digest.readUIntBE(0, 6) / 2 ** 48;
  };
}

export function participantsFingerprint(userIds) {
  return createHash("sha256")
    .update([...userIds].sort().join(","))
    .digest("hex");
}

/** Pure, deterministic draw. */
export function computeDraw({ participants, excluded = [], count, seed }) {
  const pool = [...new Set(participants)]
    .filter((id) => !excluded.includes(id))
    .sort();
  return drawGiveawayWinners(pool, count, seededRandom(seed));
}

function participantsOf(giveawayId) {
  return db
    .prepare(
      "SELECT user_id FROM giveaway_entries WHERE giveaway_id=? ORDER BY user_id",
    )
    .all(giveawayId)
    .map((row) => row.user_id);
}

/** Must run inside the caller's transaction when closing the giveaway. */
export function recordDraw({
  giveawayId,
  guildId,
  count,
  kind = "draw",
  actorId = null,
  seed = randomBytes(32).toString("hex"),
  now = Date.now(),
}) {
  const participants = participantsOf(giveawayId);
  const excluded =
    kind === "reroll"
      ? db
          .prepare(
            "SELECT winners_json FROM giveaway_draws WHERE giveaway_id=?",
          )
          .all(giveawayId)
          .flatMap((row) => JSON.parse(row.winners_json))
      : [];
  const winners = computeDraw({ participants, excluded, count, seed });
  db.prepare(
    `INSERT INTO giveaway_draws(giveaway_id,guild_id,kind,seed,participants_hash,participants_count,excluded_json,winners_json,actor_id,drawn_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    giveawayId,
    guildId,
    kind,
    seed,
    participantsFingerprint(participants),
    participants.length,
    JSON.stringify(excluded),
    JSON.stringify(winners),
    actorId,
    now,
  );
  return { winners, seed, participantsCount: participants.length, excluded };
}

export function listDraws(giveawayId, guildId) {
  return db
    .prepare(
      "SELECT * FROM giveaway_draws WHERE giveaway_id=? AND guild_id=? ORDER BY id",
    )
    .all(giveawayId, guildId)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      seed: row.seed,
      participantsHash: row.participants_hash,
      participantsCount: row.participants_count,
      excluded: JSON.parse(row.excluded_json),
      winners: JSON.parse(row.winners_json),
      actorId: row.actor_id,
      drawnAt: row.drawn_at,
    }));
}

/**
 * Replays every stored draw against the current participant list.
 * Detects a changed participant set (hash mismatch) and any winner mismatch.
 */
export function verifyGiveaway(giveawayId, guildId, winnerCount) {
  const draws = listDraws(giveawayId, guildId);
  const participants = participantsOf(giveawayId);
  const hash = participantsFingerprint(participants);
  return draws.map((draw) => {
    const replay = computeDraw({
      participants,
      excluded: draw.excluded,
      count: draw.kind === "reroll" ? draw.winners.length || 1 : winnerCount,
      seed: draw.seed,
    });
    return {
      ...draw,
      participantsMatch: draw.participantsHash === hash,
      winnersMatch: JSON.stringify(replay) === JSON.stringify(draw.winners),
    };
  });
}
