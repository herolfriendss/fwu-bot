import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-quests-")), "economy.sqlite");
const { db } = await import("../database.js");
await import("./community.js");
await import("./clans.js");
const Q = await import("./quests.js");

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const balance = (guildId, userId) =>
  Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId)?.balance ?? 0);
const setLevels = (guildId, userId, { xp = 0, messages = 0, voice = 0 }) =>
  db.prepare(`INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,0,?,?,0)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=excluded.xp, messages=excluded.messages, voice_minutes=excluded.voice_minutes`)
    .run(guildId, userId, xp, messages, voice);
let n = 30;
const freshGuild = () => `10000000000000${++n}`;

/** Pushes every counter far past every goal, whichever three quests were drawn. */
const finishEverything = (guild) => {
  setLevels(guild, USER, { xp: 999_999, messages: 999_999, voice: 999_999 });
  for (let i = 0; i < 40; i += 1) {
    db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
      VALUES(?,?,?,?,?,?,'{}',?)`).run(`${guild}-r${i}`, guild, USER, "slots", 5000, 9000, Date.now());
  }
  db.prepare("INSERT OR REPLACE INTO fwu_clan_members(guild_id,user_id,clan_id,role,contributed,joined_at) VALUES(?,?,?,'membre',?,?)")
    .run(guild, USER, 1, 50_000, Date.now());
};

test("the same member sees the same three quests all day", () => {
  const a = Q.questsFor(GUILD, USER, 20_000);
  const b = Q.questsFor(GUILD, USER, 20_000);
  assert.equal(a.length, Q.QUESTS_PER_DAY);
  assert.deepEqual(a.map((q) => q.key), b.map((q) => q.key));
  assert.equal(new Set(a.map((q) => q.key)).size, Q.QUESTS_PER_DAY, "pas de doublon dans la journée");
});

test("quests change from day to day and from member to member", () => {
  const today = Q.questsFor(GUILD, USER, 20_000).map((q) => q.key).join();
  const tomorrow = Q.questsFor(GUILD, USER, 20_001).map((q) => q.key).join();
  const other = Q.questsFor(GUILD, "200000000000000002", 20_000).map((q) => q.key).join();
  assert.ok(today !== tomorrow || today !== other, "les quêtes ne doivent pas être figées pour tout le monde");
});

test("every quest in the catalogue reads a counter that exists", () => {
  const known = Object.keys(Q.counters(GUILD, USER));
  for (const quest of Q.QUEST_CATALOGUE) {
    assert.ok(known.includes(quest.counter), `${quest.key} lit un compteur inconnu : ${quest.counter}`);
    assert.ok(quest.goal > 0 && quest.reward > 0);
  }
});

test("progress counts only what happens after the day starts", () => {
  const guild = freshGuild();
  setLevels(guild, USER, { messages: 500, xp: 9000 });
  Q.questBoard(guild, USER); // freezes the baseline at 500 messages
  setLevels(guild, USER, { messages: 512, xp: 9100 });

  const board = Q.questBoard(guild, USER);
  const messageQuest = board.quests.find((q) => q.counter === "messages");
  if (messageQuest) {
    assert.equal(messageQuest.raw, 12, "les 500 messages d'avant ne comptent pas");
    assert.equal(messageQuest.done, messageQuest.goal <= 12);
  }
  assert.ok(board.quests.every((q) => q.progress <= q.goal));
});

test("a casino loss reads as no progress rather than a negative", () => {
  const guild = freshGuild();
  db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
    VALUES(?,?,?,?,?,?,'{}',?)`).run(`${guild}-win`, guild, USER, "mines", 100, 5000, Date.now());
  Q.questBoard(guild, USER);
  db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
    VALUES(?,?,?,?,?,?,'{}',?)`).run(`${guild}-lose`, guild, USER, "mines", 9000, 0, Date.now());
  assert.ok(Q.questBoard(guild, USER).quests.every((q) => q.raw >= 0));
});

test("an unfinished quest pays nothing", () => {
  const guild = freshGuild();
  Q.questBoard(guild, USER);
  assert.deepEqual(Q.claimQuests({ guildId: guild, userId: USER }), { paid: [], money: 0, xp: 0, bonus: false });
  assert.equal(balance(guild, USER), 0);
});

test("a finished quest pays once, and the bonus lands when all three are done", () => {
  const guild = freshGuild();
  const day = Q.dayNumber();
  const quests = Q.questsFor(guild, USER, day);
  Q.questBoard(guild, USER);
  finishEverything(guild);

  const board = Q.questBoard(guild, USER);
  assert.equal(board.allDone, true, "toutes les quêtes doivent être finies");

  const claim = Q.claimQuests({ guildId: guild, userId: USER });
  const expected = quests.reduce((sum, q) => sum + q.reward, 0) + Q.ALL_DONE_BONUS;
  assert.equal(claim.paid.length, Q.QUESTS_PER_DAY);
  assert.equal(claim.bonus, true);
  assert.equal(claim.money, expected);
  assert.equal(balance(guild, USER), expected);

  const again = Q.claimQuests({ guildId: guild, userId: USER });
  assert.equal(again.money, 0, "rien n'est payé deux fois");
  assert.equal(balance(guild, USER), expected);
});

test("the board remembers what was already claimed", () => {
  const guild = freshGuild();
  Q.questBoard(guild, USER);
  finishEverything(guild);
  Q.claimQuests({ guildId: guild, userId: USER });
  const board = Q.questBoard(guild, USER);
  assert.ok(board.quests.some((q) => q.claimed));
  assert.equal(board.claimable.length, 0);
  assert.equal(board.bonusClaimed, true);
});

test("the streak counts consecutive days finished, and breaks on a gap", () => {
  const guild = freshGuild();
  const today = Q.dayNumber();
  const insert = db.prepare("INSERT INTO fwu_quest_days(guild_id,user_id,day,baseline_json,claimed_json,created_at) VALUES(?,?,?,'{}',?,?)");
  insert.run(guild, USER, today, JSON.stringify(["__bonus"]), Date.now());
  insert.run(guild, USER, today - 1, JSON.stringify(["__bonus"]), Date.now());
  insert.run(guild, USER, today - 3, JSON.stringify(["__bonus"]), Date.now());
  assert.equal(Q.questStreak(guild, USER), 2, "le trou du jour -2 casse la série");
});

test("a day where the bonus was not taken does not extend the streak", () => {
  const guild = freshGuild();
  const today = Q.dayNumber();
  db.prepare("INSERT INTO fwu_quest_days(guild_id,user_id,day,baseline_json,claimed_json,created_at) VALUES(?,?,?,'{}',?,?)")
    .run(guild, USER, today, JSON.stringify(["bavard"]), Date.now());
  assert.equal(Q.questStreak(guild, USER), 0);
});

test("old quest days are pruned", () => {
  const guild = freshGuild();
  db.prepare("INSERT INTO fwu_quest_days(guild_id,user_id,day,baseline_json,claimed_json,created_at) VALUES(?,?,?,'{}','[]',?)")
    .run(guild, USER, Q.dayNumber() - 100, Date.now());
  assert.ok(Q.pruneQuestDays() >= 1);
});
