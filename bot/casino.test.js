import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pnd-casino-test-"));
process.env.HER_DB_PATH = join(dir, "economy.sqlite");
const { db } = await import("./database.js");
const {
  resolveRouletteOutcome,
  resolveSlotsOutcome,
  settleCasinoRound,
  playCasinoRoulette,
  playCasinoCoinflip,
  playCasinoDice,
  resolveCasinoCoinflipOutcome,
  resolveCasinoDiceOutcome,
  casinoStats,
} = await import("./casino.js");
const guildId = "1562643485981544559";
const userId = "12345678901234567";

test("roulette pays gross return correctly for red, green and straight number", () => {
  assert.deepEqual(resolveRouletteOutcome({ bet: 100, choice: "rouge", number: 1 }), {
    number: 1, color: "red", choice: "red", won: true, multiplier: 2, payout: 200,
  });
  assert.equal(resolveRouletteOutcome({ bet: 100, choice: "vert", number: 0 }).payout, 3600);
  assert.equal(resolveRouletteOutcome({ bet: 100, choice: "17", number: 17 }).payout, 3600);
  assert.equal(resolveRouletteOutcome({ bet: 100, choice: "noir", number: 0 }).payout, 0);
});

test("slots validate symbols and calculate a bounded payout", () => {
  assert.equal(resolveSlotsOutcome({ bet: 100, symbols: ["7️⃣", "7️⃣", "7️⃣"] }).payout, 1500);
  assert.equal(resolveSlotsOutcome({ bet: 100, symbols: ["🍒", "🍋", "🍒"] }).payout, 200);
  assert.throws(() => resolveSlotsOutcome({ bet: 100, symbols: ["bad", "🍋", "🍒"] }), /invalide/);
});

test("casino settlement debits and credits atomically and is idempotent", () => {
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance) VALUES(?,?,?)").run(guildId, userId, 1000);
  const args = { idempotencyKey: "test-round-0001", guildId, userId, game: "roulette", bet: 100, payout: 200, outcome: { number: 1 } };
  const first = settleCasinoRound(args);
  const replay = settleCasinoRound(args);
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId).balance), 1100);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM economy_ledger WHERE guild_id=? AND user_id=?").get(guildId, userId).n), 2);
  assert.throws(() => settleCasinoRound({ ...args, bet: 200 }), /clé d'idempotence/);
});

test("insufficient funds do not create a round or ledger entries", () => {
  assert.throws(() => playCasinoRoulette({ idempotencyKey: "test-round-0002", guildId, userId, bet: 5000, choice: "rouge", draw: () => 1 }), /insuffisant/);
  assert.equal(casinoStats(guildId, userId).rounds, 1);
});

test("coinflip and dice outcomes use gross returns and the same PND ledger", () => {
  assert.deepEqual(resolveCasinoCoinflipOutcome({ bet: 100, choice: "pile", result: "pile" }), {
    choice: "pile", result: "pile", won: true, multiplier: 2, payout: 200,
  });
  assert.equal(resolveCasinoDiceOutcome({ bet: 100, choice: 6, result: 6 }).payout, 600);
  assert.equal(resolveCasinoDiceOutcome({ bet: 100, choice: 2, result: 5 }).payout, 0);
  const coin = playCasinoCoinflip({ idempotencyKey: "test-coinflip-01", guildId, userId, bet: 100, choice: "face", draw: () => 1 });
  const dice = playCasinoDice({ idempotencyKey: "test-dice-0001", guildId, userId, bet: 100, choice: 6, draw: () => 6 });
  assert.equal(coin.outcome.won, true);
  assert.equal(dice.payout, 600);
  assert.equal(casinoStats(guildId, userId).rounds, 3);
});

test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
