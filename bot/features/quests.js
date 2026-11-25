// Daily quests — three a day, drawn from what the bots already count.
//
// Progress is never pushed from a dozen call sites: at the first look of the
// day a baseline of the member's counters is frozen, and progress is simply
// today's counters minus that baseline. Nothing to instrument, nothing to
// drift, and a bot that was offline loses nothing.
import { createHash } from "node:crypto";
import { db, transaction, tableExists } from "../database.js";
import { publishEventSafe } from "../event-bus.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS fwu_quest_days (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, day INTEGER NOT NULL,
    baseline_json TEXT NOT NULL, claimed_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, day)
  );
`);

export const QUESTS_PER_DAY = 3;
const DAY_MS = 86_400_000;
const MAX_BALANCE = 1_000_000_000_000;

/** Every quest reads one counter. `goal` is the delta to reach within the day. */
export const QUEST_CATALOGUE = Object.freeze([
  { key: "bavard", counter: "messages", goal: 20, emoji: "💬", label: "Envoyer 20 messages", reward: 800, xp: 60 },
  { key: "causeur", counter: "messages", goal: 60, emoji: "🗣️", label: "Envoyer 60 messages", reward: 1800, xp: 150 },
  { key: "vocal", counter: "voiceMinutes", goal: 20, emoji: "🎙️", label: "Passer 20 minutes en vocal", reward: 1200, xp: 90 },
  { key: "vocal_long", counter: "voiceMinutes", goal: 60, emoji: "🎧", label: "Passer 1 heure en vocal", reward: 2500, xp: 200 },
  { key: "xp", counter: "xp", goal: 300, emoji: "⭐", label: "Gagner 300 XP", reward: 1000, xp: 0 },
  { key: "joueur", counter: "casinoRounds", goal: 5, emoji: "🎰", label: "Jouer 5 parties au casino", reward: 1500, xp: 80 },
  { key: "flambeur", counter: "casinoWagered", goal: 10_000, emoji: "💸", label: "Miser 10 000 PND au casino", reward: 2000, xp: 100 },
  { key: "mecene", counter: "clanContributed", goal: 5000, emoji: "⚔️", label: "Verser 5 000 PND au coffre de ton clan", reward: 1500, xp: 120 },
  { key: "gagnant", counter: "casinoNet", goal: 2000, emoji: "🍀", label: "Finir 2 000 PND au-dessus au casino", reward: 2500, xp: 150 },
]);
const BY_KEY = new Map(QUEST_CATALOGUE.map((quest) => [quest.key, quest]));

export const dayNumber = (now = Date.now()) => Math.floor(now / DAY_MS);

/**
 * Pure: the three quests of the day for one member. Deterministic, so the
 * same day always shows the same quests without storing them.
 */
export function questsFor(guildId, userId, day) {
  const digest = createHash("sha256").update(`${guildId}:${userId}:${day}`).digest();
  const pool = [...QUEST_CATALOGUE];
  const picked = [];
  for (let i = 0; i < QUESTS_PER_DAY && pool.length; i += 1) {
    picked.push(...pool.splice(digest[i] % pool.length, 1));
  }
  return picked;
}

/** The counters every quest is measured against. */
export function counters(guildId, userId) {
  const level = (tableExists("community_levels")
    && db.prepare("SELECT xp, messages, voice_minutes FROM community_levels WHERE guild_id=? AND user_id=?").get(guildId, userId))
    || { xp: 0, messages: 0, voice_minutes: 0 };
  const casino = tableExists("casino_rounds")
    ? db.prepare("SELECT COUNT(*) AS rounds, COALESCE(SUM(bet),0) AS wagered, COALESCE(SUM(payout-bet),0) AS net FROM casino_rounds WHERE guild_id=? AND user_id=?").get(guildId, userId)
    : null;
  const clan = tableExists("fwu_clan_members")
    ? db.prepare("SELECT contributed FROM fwu_clan_members WHERE guild_id=? AND user_id=?").get(guildId, userId)
    : null;
  return {
    xp: Number(level.xp), messages: Number(level.messages), voiceMinutes: Number(level.voice_minutes),
    casinoRounds: Number(casino?.rounds ?? 0), casinoWagered: Number(casino?.wagered ?? 0),
    casinoNet: Number(casino?.net ?? 0), clanContributed: Number(clan?.contributed ?? 0),
  };
}

/** Freezes today's starting point the first time the member looks at their quests. */
function dayRow(guildId, userId, now) {
  const day = dayNumber(now);
  const existing = db.prepare("SELECT * FROM fwu_quest_days WHERE guild_id=? AND user_id=? AND day=?").get(guildId, userId, day);
  if (existing) return { day, baseline: JSON.parse(existing.baseline_json), claimed: new Set(JSON.parse(existing.claimed_json)) };
  const baseline = counters(guildId, userId);
  db.prepare("INSERT INTO fwu_quest_days(guild_id,user_id,day,baseline_json,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, day, JSON.stringify(baseline), now);
  return { day, baseline, claimed: new Set() };
}

/** Today's three quests with their progress and whether the reward was taken. */
export function questBoard(guildId, userId, now = Date.now()) {
  const { day, baseline, claimed } = dayRow(guildId, userId, now);
  const current = counters(guildId, userId);
  const quests = questsFor(guildId, userId, day).map((quest) => {
    // A negative swing (losing at the casino) must read as zero, not as a wrap-around.
    const progress = Math.max(0, Number(current[quest.counter] ?? 0) - Number(baseline[quest.counter] ?? 0));
    return {
      ...quest,
      progress: Math.min(progress, quest.goal),
      raw: progress,
      done: progress >= quest.goal,
      claimed: claimed.has(quest.key),
    };
  });
  return {
    day,
    quests,
    claimable: quests.filter((quest) => quest.done && !quest.claimed),
    allDone: quests.every((quest) => quest.done),
    bonusClaimed: claimed.has("__bonus"),
  };
}

const credit = (guildId, userId, amount, reason, now) => {
  if (amount <= 0) return;
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const given = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance<=?")
    .run(amount, guildId, userId, MAX_BALANCE - amount);
  if (!Number(given.changes)) throw new Error("Le paiement dépasserait le solde maximal autorisé.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, amount, reason, now);
};

export const ALL_DONE_BONUS = 3000;

/**
 * Pays every finished quest that has not been paid yet, plus the bonus when
 * all three are done. Marking and paying happen in one transaction, so a
 * double click cannot pay twice.
 */
export function claimQuests({ guildId, userId, now = Date.now() }) {
  return transaction(() => {
    const board = questBoard(guildId, userId, now);
    const claimed = new Set(JSON.parse(
      db.prepare("SELECT claimed_json FROM fwu_quest_days WHERE guild_id=? AND user_id=? AND day=?").get(guildId, userId, board.day).claimed_json,
    ));
    const paid = [];
    let money = 0;
    let xp = 0;
    for (const quest of board.quests) {
      if (!quest.done || claimed.has(quest.key)) continue;
      claimed.add(quest.key);
      money += quest.reward;
      xp += quest.xp;
      paid.push(quest);
    }
    const bonus = board.allDone && !claimed.has("__bonus");
    if (bonus) {
      claimed.add("__bonus");
      money += ALL_DONE_BONUS;
    }
    if (!paid.length && !bonus) return { paid: [], money: 0, xp: 0, bonus: false };

    db.prepare("UPDATE fwu_quest_days SET claimed_json=? WHERE guild_id=? AND user_id=? AND day=?")
      .run(JSON.stringify([...claimed]), guildId, userId, board.day);
    credit(guildId, userId, money, "quete_recompense", now);
    for (const quest of paid) {
      publishEventSafe({
        guildId, kind: "quest.completed", subjectId: userId, source: "fwu",
        payload: { key: quest.key, points: Math.max(10, Math.round(quest.reward / 100)) },
      });
    }
    return { paid, money, xp, bonus };
  });
}

/** XP earned from quests is applied by the caller, which owns the level tables. */
export const questByKey = (key) => BY_KEY.get(key) ?? null;

export function questStreak(guildId, userId, now = Date.now()) {
  const today = dayNumber(now);
  const rows = db.prepare("SELECT day, claimed_json FROM fwu_quest_days WHERE guild_id=? AND user_id=? AND day<=? ORDER BY day DESC LIMIT 60")
    .all(guildId, userId, today);
  let streak = 0;
  for (const [index, row] of rows.entries()) {
    const expected = today - index;
    if (Number(row.day) !== expected) break;
    if (!JSON.parse(row.claimed_json).includes("__bonus")) break;
    streak += 1;
  }
  return streak;
}

/** Keeps the table from growing without bound; 60 days is enough for the streak. */
export const pruneQuestDays = (now = Date.now()) =>
  Number(db.prepare("DELETE FROM fwu_quest_days WHERE day < ?").run(dayNumber(now) - 60).changes);
