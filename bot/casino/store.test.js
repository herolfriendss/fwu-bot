import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-casino-store-")), "economy.sqlite");
const { db } = await import("../database.js");
const {
  openRound, loadRound, stakeMore, closeRound, openRoundOf, saveRoundState,
  jackpotAmount, jackpotInfo, awardJackpot, contributeJackpot, JACKPOT_SEED,
  vipTierFor, vipStatus, cashbackDue, claimCashback, walletBalance, casinoLeaderboard,
} = await import("./store.js");

const GUILD = "100000000000000001";
const ALICE = "200000000000000001";
const BOB = "200000000000000002";
const fund = (userId, amount) =>
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=excluded.balance")
    .run(GUILD, userId, amount);

test("opening a round takes the stake out of the wallet", () => {
  fund(ALICE, 1000);
  const round = openRound({ guildId: GUILD, userId: ALICE, game: "mines", bet: 200, state: { mines: 3 } });
  assert.equal(walletBalance(GUILD, ALICE), 800);
  assert.equal(loadRound(round.id).staked, 200);
  assert.equal(openRoundOf(GUILD, ALICE).id, round.id);
  closeRound({ id: round.id, payout: 0, outcome: {} });
});

test("a player cannot run two rounds at once", () => {
  fund(ALICE, 1000);
  const first = openRound({ guildId: GUILD, userId: ALICE, game: "mines", bet: 100, state: {} });
  assert.throws(() => openRound({ guildId: GUILD, userId: ALICE, game: "crash", bet: 100, state: {} }), /déjà une partie/);
  closeRound({ id: first.id, payout: 0, outcome: {} });
});

test("a stake the wallet cannot cover is refused and changes nothing", () => {
  fund(BOB, 50);
  assert.throws(() => openRound({ guildId: GUILD, userId: BOB, game: "mines", bet: 500, state: {} }), /insuffisant/);
  assert.equal(walletBalance(GUILD, BOB), 50);
  assert.equal(openRoundOf(GUILD, BOB), null);
});

test("extra stakes are charged and added to the round", () => {
  fund(ALICE, 1000);
  const round = openRound({ guildId: GUILD, userId: ALICE, game: "blackjack", bet: 100, state: {} });
  assert.equal(stakeMore({ id: round.id, amount: 100 }), 200);
  assert.equal(walletBalance(GUILD, ALICE), 800);
  const closed = closeRound({ id: round.id, payout: 400, outcome: { result: "win" } });
  assert.equal(closed.net, 200);
  assert.equal(walletBalance(GUILD, ALICE), 1200);
});

test("closing a round twice never pays twice", () => {
  fund(ALICE, 1000);
  const round = openRound({ guildId: GUILD, userId: ALICE, game: "mines", bet: 100, state: {} });
  closeRound({ id: round.id, payout: 300, outcome: {} });
  const after = walletBalance(GUILD, ALICE);
  const again = closeRound({ id: round.id, payout: 300, outcome: {} });
  assert.equal(again.duplicate, true);
  assert.equal(walletBalance(GUILD, ALICE), after);
});

test("a closed round refuses further stakes", () => {
  fund(ALICE, 1000);
  const round = openRound({ guildId: GUILD, userId: ALICE, game: "mines", bet: 100, state: {} });
  closeRound({ id: round.id, payout: 0, outcome: {} });
  assert.throws(() => stakeMore({ id: round.id, amount: 50 }), /déjà terminée/);
});

test("round state survives between two presses", () => {
  fund(ALICE, 1000);
  const round = openRound({ guildId: GUILD, userId: ALICE, game: "mines", bet: 100, state: { revealed: [] } });
  saveRoundState(round.id, { revealed: [4, 7] });
  assert.deepEqual(loadRound(round.id).state.revealed, [4, 7]);
  closeRound({ id: round.id, payout: 0, outcome: {} });
});

test("every stake feeds the jackpot, and winning it empties and reseeds the pot", () => {
  const guild = "100000000000000002";
  assert.equal(jackpotAmount(guild), JACKPOT_SEED);
  contributeJackpot(guild, 100_000);
  assert.equal(jackpotAmount(guild), JACKPOT_SEED + 1000);

  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guild, ALICE);
  const won = awardJackpot({ guildId: guild, userId: ALICE });
  assert.equal(won, JACKPOT_SEED + 1000);
  assert.equal(walletBalance(guild, ALICE), won);
  assert.equal(jackpotAmount(guild), JACKPOT_SEED);
  assert.equal(jackpotInfo(guild).lastWinner, ALICE);
});

test("the VIP ladder climbs with the lifetime wagered amount", () => {
  assert.equal(vipTierFor(0).key, "bronze");
  assert.equal(vipTierFor(50_000).key, "argent");
  assert.equal(vipTierFor(999_999).key, "or");
  assert.equal(vipTierFor(5_000_000).key, "diamant");
  assert.equal(vipTierFor(5_000_000).next, null);
  assert.equal(vipTierFor(0).toNext, 50_000);
  assert.equal(vipStatus(GUILD, "200000000000000009").key, "bronze");
});

test("cashback pays a share of yesterday's losses, once", () => {
  const guild = "100000000000000003";
  const day = Math.floor(Date.now() / 86_400_000) - 1;
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guild, BOB);
  // Enough lifetime volume for the Or tier (2%), all of it lost yesterday.
  db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
    VALUES(?,?,?,?,?,?,'{}',?)`).run("cb-1", guild, BOB, "mines", 300_000, 0, day * 86_400_000 + 500);

  const due = cashbackDue(guild, BOB);
  assert.equal(due.tier.key, "or");
  assert.equal(due.amount, 6000);

  assert.equal(claimCashback({ guildId: guild, userId: BOB }).amount, 6000);
  assert.equal(walletBalance(guild, BOB), 6000);
  assert.equal(claimCashback({ guildId: guild, userId: BOB }).amount, 0, "pas deux fois le même jour");
});

test("bronze players have no cashback", () => {
  const guild = "100000000000000004";
  assert.equal(cashbackDue(guild, BOB).amount, 0);
  assert.match(cashbackDue(guild, BOB).reason, /Argent/);
});

test("the leaderboard ranks players by net result", () => {
  const guild = "100000000000000005";
  const rows = [["w1", ALICE, 100, 900], ["w2", BOB, 100, 0]];
  for (const [key, user, bet, payout] of rows) {
    db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
      VALUES(?,?,?,?,?,?,'{}',?)`).run(key, guild, user, "slots", bet, payout, Date.now());
  }
  const board = casinoLeaderboard(guild);
  assert.equal(board[0].userId, ALICE);
  assert.equal(board[0].net, 800);
  assert.equal(board[1].net, -100);
});
