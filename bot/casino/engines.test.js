import test from "node:test";
import assert from "node:assert/strict";
import { createShoe, handValue, shuffle } from "./cards.js";
import { blackjackActions, blackjackAct, blackjackDealerPlay, blackjackSettle, newBlackjackGame } from "./blackjack.js";
import { parseRouletteBets, resolveRouletteSpin, rouletteBet, pocketColor } from "./roulette.js";
import { resolveSlots, spinSlots, WILD, SCATTER, LINE_COUNT } from "./slots.js";

const fixedRng = (n) => n - 1;
const game = (over = {}) => ({
  shoe: createShoe(6), dealer: ["Ts", "7h"], active: 0, insurance: 0, phase: "player",
  hands: [{ cards: ["9s", "7d"], bet: 100, doubled: false, done: false, surrendered: false, fromSplit: false }],
  ...over,
});

test("createShoe and shuffle keep every card", () => {
  const shoe = createShoe(6);
  assert.equal(shoe.length, 312);
  const mixed = shuffle(shoe, fixedRng);
  assert.equal(mixed.length, 312);
  assert.deepEqual([...shoe].sort(), [...mixed].sort());
});

test("handValue downgrades aces to avoid busting", () => {
  assert.deepEqual(handValue(["As", "Kh"]), { total: 21, soft: true, busted: false });
  assert.deepEqual(handValue(["As", "9h", "5d"]), { total: 15, soft: false, busted: false });
  assert.deepEqual(handValue(["As", "As", "9h"]), { total: 21, soft: true, busted: false });
  assert.equal(handValue(["Kh", "Qd", "5s"]).busted, true);
});

test("a dealt game gives two cards to each side", () => {
  const state = newBlackjackGame({ bet: 100, rng: fixedRng });
  assert.equal(state.hands[0].cards.length, 2);
  assert.equal(state.dealer.length, 2);
  assert.equal(state.shoe.length, 312 - 4);
});

test("double and split are offered only on a fresh two-card hand", () => {
  assert.deepEqual(blackjackActions(game()).sort(), ["double", "hit", "stand", "surrender"]);
  assert.deepEqual(blackjackActions(game({ hands: [{ cards: ["8s", "8d"], bet: 100, done: false, fromSplit: false }] })).sort(),
    ["double", "hit", "split", "stand", "surrender"]);
  assert.deepEqual(blackjackActions(game({ hands: [{ cards: ["5s", "4d", "2c"], bet: 100, done: false }] })).sort(), ["hit", "stand"]);
  assert.deepEqual(blackjackActions(game({ phase: "dealer" })), []);
});

test("insurance is offered against an ace and paid 2:1 on a dealer blackjack", () => {
  const offered = game({ dealer: ["As", "Kh"] });
  assert.ok(blackjackActions(offered).includes("insurance"));
  const insured = blackjackAct(offered, "insurance", fixedRng);
  assert.equal(insured.insurance, 50);
  assert.equal(insured.extraStake, 50);
  assert.ok(!blackjackActions(insured).includes("insurance"), "l'assurance ne se prend qu'une fois");
  const settled = blackjackSettle({ ...insured, phase: "done" });
  assert.equal(settled.insurancePayout, 150);
});

test("splitting charges a second stake and makes two hands", () => {
  const split = blackjackAct(game({ hands: [{ cards: ["8s", "8d"], bet: 100, done: false, fromSplit: false }] }), "split", fixedRng);
  assert.equal(split.hands.length, 2);
  assert.equal(split.extraStake, 100);
  assert.ok(split.hands.every((hand) => hand.cards.length === 2 && hand.fromSplit));
});

test("doubling charges the stake again, draws once and ends the hand", () => {
  const doubled = blackjackAct(game({ hands: [{ cards: ["5s", "6d"], bet: 100, done: false, fromSplit: false }] }), "double", fixedRng);
  assert.equal(doubled.extraStake, 100);
  assert.equal(doubled.hands[0].bet, 200);
  assert.equal(doubled.hands[0].cards.length, 3);
  assert.equal(doubled.phase, "dealer");
});

test("the dealer stands on soft 17 and plays out below it", () => {
  const stood = blackjackDealerPlay(game({ dealer: ["As", "6h"], phase: "dealer", hands: [{ cards: ["Ts", "9d"], bet: 100, done: true }] }));
  assert.deepEqual(stood.dealer, ["As", "6h"]);
  const drawn = blackjackDealerPlay(game({ dealer: ["5s", "6h"], phase: "dealer", hands: [{ cards: ["Ts", "9d"], bet: 100, done: true }] }));
  assert.ok(handValue(drawn.dealer).total >= 17);
});

test("the dealer does not draw when every player hand is already out", () => {
  const busted = blackjackDealerPlay(game({ dealer: ["5s", "6h"], phase: "dealer", hands: [{ cards: ["Ts", "9d", "8c"], bet: 100, done: true }] }));
  assert.deepEqual(busted.dealer, ["5s", "6h"]);
});

test("settlement pays a natural 3:2 and returns half on surrender", () => {
  const natural = blackjackSettle(game({ dealer: ["Ts", "7h"], hands: [{ cards: ["As", "Kd"], bet: 100, fromSplit: false }], phase: "done" }));
  assert.equal(natural.hands[0].result, "blackjack");
  assert.equal(natural.hands[0].payout, 250);

  const pushed = blackjackSettle(game({ dealer: ["As", "Kh"], hands: [{ cards: ["As", "Kd"], bet: 100, fromSplit: false }], phase: "done" }));
  assert.equal(pushed.hands[0].result, "push");
  assert.equal(pushed.hands[0].payout, 100);

  const given = blackjackSettle(game({ hands: [{ cards: ["Ts", "6d"], bet: 100, surrendered: true }], phase: "done" }));
  assert.equal(given.hands[0].payout, 50);

  const twentyOneAfterSplit = blackjackSettle(game({ dealer: ["Ts", "8h"], hands: [{ cards: ["As", "Kd"], bet: 100, fromSplit: true }], phase: "done" }));
  assert.equal(twentyOneAfterSplit.hands[0].result, "win", "21 après split n'est pas un blackjack");
  assert.equal(twentyOneAfterSplit.hands[0].payout, 200);
});

test("roulette knows its colours and its layout bets", () => {
  assert.equal(pocketColor(0), "vert");
  assert.equal(pocketColor(32), "rouge");
  assert.equal(pocketColor(33), "noir");
  assert.deepEqual(rouletteBet("carre", 1).numbers, [1, 2, 4, 5]);
  assert.deepEqual(rouletteBet("sixain", 4).numbers, [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(rouletteBet("transversale", 7).numbers, [7, 8, 9]);
  assert.deepEqual(rouletteBet("cheval", "5-8").numbers, [5, 8]);
  assert.deepEqual(rouletteBet("cheval", "0-2").numbers, [0, 2]);
  assert.equal(rouletteBet("douzaine2").multiplier, 3);
  assert.equal(rouletteBet("colonne1").numbers.includes(34), true);
  assert.equal(rouletteBet("17").multiplier, 36);
});

test("roulette refuses impossible positions", () => {
  assert.throws(() => rouletteBet("cheval", "6-7"), /se toucher/);
  assert.throws(() => rouletteBet("transversale", 5), /Transversale/);
  assert.throws(() => rouletteBet("carre", 3), /Carré/);
  assert.throws(() => rouletteBet("plein", 37), /Numéro plein/);
  assert.throws(() => rouletteBet("nimportequoi"), /inconnu/);
});

test("roulette parses several bets on one line", () => {
  const bets = parseRouletteBets("rouge:100, 17:50, cheval 5-6:25", 10);
  assert.equal(bets.length, 3);
  assert.deepEqual(bets.map((bet) => bet.amount), [100, 50, 25]);
  assert.equal(parseRouletteBets("noir", 80)[0].amount, 80);
  assert.throws(() => parseRouletteBets("", 10), /au moins une mise/);
});

test("a spin pays every winning bet and only those", () => {
  const spin = resolveRouletteSpin(parseRouletteBets("rouge:100, noir:100, plein 32:10", 10), 32);
  assert.equal(spin.color, "rouge");
  assert.equal(spin.totalBet, 210);
  assert.equal(spin.totalPayout, 200 + 360);
  assert.deepEqual(spin.results.map((r) => r.won), [true, false, true]);
});

test("zero takes every outside bet", () => {
  const spin = resolveRouletteSpin(parseRouletteBets("rouge:50, pair:50, manque:50, douzaine1:50", 10), 0);
  assert.equal(spin.totalPayout, 0);
});

test("slots pay three of a kind on a line and let the wild substitute", () => {
  const grid = [["🍒", "💎", "🍋"], ["🍉", "💎", "🔔"], ["⭐", "💎", "🍒"]];
  const result = resolveSlots({ bet: 100, grid });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].symbol, "💎");
  assert.equal(result.payout, Math.floor((100 / LINE_COUNT) * 50));

  const wild = resolveSlots({ bet: 100, grid: [["🍒", "⭐", "🍋"], ["🍉", WILD, "🔔"], ["🍒", "⭐", "🍋"]] });
  assert.equal(wild.lines[0].symbol, "⭐");
  assert.equal(wild.lines[0].length, 3);
});

test("three sevens on a line flag the jackpot", () => {
  const result = resolveSlots({ bet: 100, grid: [["7️⃣", "🍒", "🍋"], ["7️⃣", "🍉", "🔔"], ["7️⃣", "⭐", "🍒"]] });
  assert.equal(result.jackpotWon, true);
});

test("scatters pay anywhere and three of them give free spins", () => {
  const three = resolveSlots({ bet: 100, grid: [[SCATTER, "🍒", "🍋"], ["🍉", SCATTER, "🔔"], ["⭐", "🍒", SCATTER]] });
  assert.equal(three.scatters, 3);
  assert.equal(three.scatterWin, 1000);
  assert.equal(three.freeSpins, 10);

  const two = resolveSlots({ bet: 100, grid: [[SCATTER, "🍒", "🍋"], ["🍉", SCATTER, "🔔"], ["⭐", "🍒", "🍋"]] });
  assert.equal(two.scatterWin, 200);
  assert.equal(two.freeSpins, 0);
});

test("a losing grid returns nothing", () => {
  const result = resolveSlots({ bet: 100, grid: [["🍒", "🍋", "🍉"], ["🍋", "🍉", "🍒"], ["🍒", "🍋", "🍉"]] });
  assert.equal(result.payout, 0);
  assert.equal(result.won, false);
});

test("a spun grid has three columns of three known symbols", () => {
  const grid = spinSlots(() => 0);
  assert.equal(grid.length, 3);
  assert.ok(grid.every((col) => col.length === 3 && col.every((symbol) => typeof symbol === "string" && symbol.length > 0)));
});
