import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pnd-casino-controls-"));
process.env.HER_DB_PATH = join(dir, "economy.sqlite");
const { db } = await import("./database.js");
const {
  assertCasinoCanStart,
  getCasinoControls,
  parisDayStart,
  playCasinoCoinflip,
  playCasinoSlots,
  setCasinoDailyWagerLimit,
  setCasinoSelfExclusion,
} = await import("./casino.js");

const guildA = "1562643485981544559";
const guildB = "1562643485981544560";
const userA = "12345678901234567";
const userB = "12345678901234568";
const now = Date.parse("2026-11-16T12:00:00.000Z");

test("Paris day boundary follows CET/CEST including DST transition days", () => {
  assert.equal(new Date(parisDayStart(Date.parse("2026-01-12T12:00:00Z"))).toISOString(), "2026-01-11T23:00:00.000Z");
  assert.equal(new Date(parisDayStart(Date.parse("2026-07-12T12:00:00Z"))).toISOString(), "2026-07-11T22:00:00.000Z");
  assert.equal(new Date(parisDayStart(Date.parse("2026-03-29T12:00:00Z"))).toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(new Date(parisDayStart(Date.parse("2026-10-25T12:00:00Z"))).toISOString(), "2026-10-24T22:00:00.000Z");
});

test("daily wager limit counts casino and legacy blackjack/roulette debit ledger entries", () => {
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance) VALUES(?,?,?)").run(guildA, userA, 20_000);
  db.prepare(`INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES
    (?,?,?,?,?),(?,?,?,?,?),(?,?,?,?,?)`).run(
      guildA, userA, -1_000, "casino_slots_bet", now - 10_000,
      guildA, userA, -2_000, "blackjack_bet", now - 5_000,
      guildA, userA, -4_000, "daily_reward", now - 1_000,
    );
  setCasinoDailyWagerLimit({ guildId: guildA, userId: userA, limit: 3_500, now });
  assertCasinoCanStart({ guildId: guildA, userId: userA, bet: 500, now });
  assert.throws(() => assertCasinoCanStart({ guildId: guildA, userId: userA, bet: 501, now }), /limite quotidienne/);
  assertCasinoCanStart({ guildId: guildB, userId: userA, bet: 1_000, now });
  assertCasinoCanStart({ guildId: guildA, userId: userB, bet: 1_000, now });
});

test("daily wager limit can be removed without removing other controls", () => {
  setCasinoSelfExclusion({ guildId: guildA, userId: userB, durationMs: 24 * 60 * 60_000, now });
  setCasinoDailyWagerLimit({ guildId: guildA, userId: userB, limit: 5_000, now });
  setCasinoDailyWagerLimit({ guildId: guildA, userId: userB, limit: null, now: now + 1 });
  const controls = getCasinoControls(guildA, userB);
  assert.equal(controls.dailyWagerLimit, null);
  assert.equal(controls.selfExcludedUntil, now + 24 * 60 * 60_000);
});

test("self-exclusion blocks all new wagers and cannot be shortened", () => {
  const first = setCasinoSelfExclusion({ guildId: guildB, userId: userA, durationMs: 7 * 24 * 60 * 60_000, now });
  const extended = setCasinoSelfExclusion({ guildId: guildB, userId: userA, durationMs: 24 * 60 * 60_000, now: now + 60_000 });
  assert.equal(extended.selfExcludedUntil, first.selfExcludedUntil);
  assert.throws(() => assertCasinoCanStart({ guildId: guildB, userId: userA, bet: 1, now: now + 60_000 }), /auto-exclusion/);
  assertCasinoCanStart({ guildId: guildB, userId: userA, bet: 1, now: first.selfExcludedUntil + 1 });
});

test("casino transaction enforces the daily cap and exclusion before any debit", () => {
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance) VALUES(?,?,?)").run(guildB, userB, 10_000);
  setCasinoDailyWagerLimit({ guildId: guildB, userId: userB, limit: 1_000, now });
  const first = playCasinoSlots({
    idempotencyKey: "casino-controls-first", guildId: guildB, userId: userB, bet: 1_000,
    now, draw: (() => { const symbols = ["🍒", "🍋", "🔔"]; let i = 0; return () => symbols[i++]; })(),
  });
  assert.equal(first.duplicate, false);
  assert.throws(() => playCasinoCoinflip({
    idempotencyKey: "casino-controls-second", guildId: guildB, userId: userB, bet: 1,
    choice: "pile", now: now + 1, draw: () => 0,
  }), /limite quotidienne/);
  assert.equal(Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildB, userB).balance), 9_000);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM casino_rounds WHERE guild_id=? AND user_id=?").get(guildB, userB).n), 1);

  setCasinoSelfExclusion({ guildId: guildB, userId: userB, durationMs: 24 * 60 * 60_000, now: now + 2 });
  assert.throws(() => playCasinoCoinflip({
    idempotencyKey: "casino-controls-third", guildId: guildB, userId: userB, bet: 1,
    choice: "pile", now: now + 3, draw: () => 0,
  }), /auto-exclusion/);
  assert.equal(Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildB, userB).balance), 9_000);
});

test("permanent self-exclusion persists and invalid controls are rejected", () => {
  const controls = setCasinoSelfExclusion({ guildId: guildA, userId: userB, durationMs: Number.MAX_SAFE_INTEGER, now });
  assert.equal(controls.selfExcludedUntil, Number.MAX_SAFE_INTEGER);
  assert.throws(() => assertCasinoCanStart({ guildId: guildA, userId: userB, bet: 10, now: now + 100_000 }), /auto-exclusion/);
  assert.throws(() => setCasinoDailyWagerLimit({ guildId: guildA, userId: userB, limit: 0, now }), /limite quotidienne/);
  assert.throws(() => setCasinoSelfExclusion({ guildId: guildA, userId: userB, durationMs: 60_000, now }), /Durée invalide/);
});

test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
