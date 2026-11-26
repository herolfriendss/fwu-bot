import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-fisc-")), "db.sqlite");
const { db } = await import("../database.js");
const cfg = await import("./fisc-config.js");
const f = await import("./fisc.js");
const streak = await import("./daily-streak.js");
const G = "900000000000000001";
const A = "900000000000000011";
const B = "900000000000000012";
const setWallet = (u, balance, bank = 0) => db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=excluded.balance, bank=excluded.bank").run(G, u, balance, bank);
const bal = (u) => db.prepare("SELECT balance, bank FROM wallets WHERE guild_id=? AND user_id=?").get(G, u);

test("transfer tax and treasury", () => {
  assert.equal(cfg.transferTax(G, 1000), 0, "off by default");
  cfg.saveFiscConfig(G, { transferRate: 5 }, "a");
  assert.equal(cfg.transferTax(G, 1000), 50);
  assert.equal(cfg.saveFiscConfig(G, { transferRate: 99 }, "a").transferRate, 20, "capped");
  cfg.changeTreasury(G, 100);
  assert.throws(() => cfg.changeTreasury(G, -500), /insuffisante/);
  assert.equal(cfg.treasury(G), 100);
});

test("weekly wealth tax: Monday from 12:00 Paris, once, wallet then bank", () => {
  cfg.saveFiscConfig(G, { wealthRate: 10, wealthThreshold: 1000 }, "a");
  setWallet(A, 500, 1500); // total 2000 -> 10 % of 1000 = 100
  const before = cfg.treasury(G);
  assert.equal(f.runWealthTax([G], Date.parse("2026-11-23T08:00:00Z")), 0, "Monday 9:00 Paris is too early");
  assert.equal(f.runWealthTax([G], Date.parse("2026-11-23T12:00:00Z")), 100);
  assert.equal(f.runWealthTax([G], Date.parse("2026-11-23T15:00:00Z")), 0, "once a week");
  assert.equal(cfg.treasury(G) - before, 100);
  assert.deepEqual({ ...bal(A) }, { balance: 400, bank: 1500 });
});

test("loans: ceiling, overdue penalty and automatic collection", () => {
  assert.equal(f.loanCeiling({ balance: 0, bank: 0 }), 1000);
  assert.equal(f.loanCeiling({ balance: 100000, bank: 0 }), 50000);
  setWallet(B, 30);
  db.prepare("INSERT INTO fisc_loans(guild_id,user_id,principal,owed,due_at,created_at) VALUES(?,?,?,?,?,?)").run(G, B, 1000, 1100, 1, 0);
  assert.equal(f.runLoanCollection(10), 30);
  const loan = db.prepare("SELECT owed, status, penalized FROM fisc_loans WHERE user_id=?").get(B);
  assert.deepEqual({ ...loan }, { owed: 1155 - 30, status: "defaulted", penalized: 1 });
});

test("forced collection: only interest and penalty reach the treasury, the principal is destroyed", () => {
  const C = "900000000000000013";
  setWallet(C, 5000);
  db.prepare("INSERT INTO fisc_loans(guild_id,user_id,principal,owed,due_at,created_at) VALUES(?,?,?,?,?,?)").run(G, C, 1000, 1100, 1, 0);
  const before = cfg.treasury(G);
  assert.equal(f.runLoanCollection(10), 1155, "owed 1100 + 5 % penalty");
  assert.equal(cfg.treasury(G) - before, 155, "interest 100 + penalty 55, never the 1000 principal");
  const loan = db.prepare("SELECT owed, status FROM fisc_loans WHERE user_id=?").get(C);
  assert.deepEqual({ ...loan }, { owed: 0, status: "repaid" });
});

test("duel resolution and payout", async () => {
  assert.equal(f.resolveDuel("pile", () => 0).challengerWins, true);
  const seq = [2, 2, 5, 1];
  const r = f.resolveDuel("des", () => seq.shift());
  assert.equal(r.challengerWins, true, "ties are re-rolled");
  setWallet(A, 1000); setWallet(B, 1000);
  db.prepare("INSERT INTO fisc_duels(id,guild_id,challenger_id,opponent_id,bet,game,created_at) VALUES(5,?,?,?,100,'pile',?)").run(G, A, B, Date.now());
  const updates = [];
  const click = (user) => ({ isButton: () => true, customId: "duel:accept:5", guildId: G, user: { id: user }, update: async (p) => updates.push(p), reply: async (p) => updates.push(p) });
  await f.handleDuelButton(click(A));
  assert.match(updates[0].content, /Seule la personne/);
  await f.handleDuelButton(click(B), { roll: () => 1 });
  assert.equal(bal(B).balance, 1100);
  assert.equal(bal(A).balance, 900);
  await f.handleDuelButton(click(B));
  assert.match(updates.at(-1).content, /terminé/);
});

test("scratch card and race odds", () => {
  assert.deepEqual(f.scratchOutcome(10, () => 0), { symbol: "💎", payout: 200, win: true });
  assert.equal(f.scratchOutcome(10, () => 99).payout, 0);
  assert.equal(f.raceOutcome(10, 3, () => 2).payout, 40);
  assert.equal(f.raceOutcome(10, 3, () => 0).payout, 0);
});

test("daily streak: +10 % per consecutive day, max +100 %, broken after 48 h", () => {
  assert.equal(streak.nextDailyStreak(G, A, null, 0), 1);
  assert.equal(streak.nextDailyStreak(G, A, 0, 24 * 3_600_000), 2);
  assert.equal(streak.nextDailyStreak(G, A, 0, 72 * 3_600_000), 1);
  assert.equal(streak.dailyStreakReward(100, 1), 100);
  assert.equal(streak.dailyStreakReward(100, 4), 130);
  assert.equal(streak.dailyStreakReward(100, 30), 200);
});
