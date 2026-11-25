import test from "node:test";
import assert from "node:assert/strict";
import { minesMultiplier, placeMines, newMinesGame, minesReveal, minesCashout, minesCashoutValue, minesNextMultiplier, TILES } from "./mines.js";
import { crashMultiplierAt, drawCrashPoint, newCrashGame, crashAdvance, crashCashout, crashPayout, GROWTH } from "./crash.js";
import { dropPlinko, resolvePlinko, RISK_TABLES, BUCKETS } from "./plinko.js";

const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };

test("the mines multiplier grows with each safe tile", () => {
  assert.equal(minesMultiplier(3, 0), 1);
  const one = minesMultiplier(3, 1);
  const two = minesMultiplier(3, 2);
  assert.ok(one > 1 && two > one, "chaque case sûre augmente le gain");
  assert.ok(one < 25 / 22 + 0.01, "la maison garde son avantage");
});

test("more mines means a steeper multiplier", () => {
  assert.ok(minesMultiplier(10, 3) > minesMultiplier(2, 3));
});

test("the mines multiplier refuses impossible positions", () => {
  assert.throws(() => minesMultiplier(0, 1), /mines invalide/);
  assert.throws(() => minesMultiplier(25, 1), /mines invalide/);
  assert.throws(() => minesMultiplier(5, 21), /révélées invalide/);
});

test("mines are placed without repeats", () => {
  const bombs = placeMines(8, (n) => n - 1);
  assert.equal(bombs.length, 8);
  assert.equal(new Set(bombs).size, 8);
  assert.ok(bombs.every((tile) => tile >= 0 && tile < TILES));
});

test("a safe tile raises the cashout and a bomb ends the round", () => {
  const game = { bet: 100, mines: 5, bombs: [0, 1, 2, 3, 4], revealed: [], phase: "playing", hit: null };
  const safe = minesReveal(game, 10);
  assert.equal(safe.phase, "playing");
  assert.equal(safe.revealed.length, 1);
  assert.ok(minesCashoutValue(safe) > 100);

  const boom = minesReveal(game, 0);
  assert.equal(boom.phase, "lost");
  assert.equal(boom.hit, 0);
  assert.equal(minesCashout(boom).payout, 0);
});

test("mines refuses a tile twice and a cashout with nothing revealed", () => {
  const game = newMinesGame({ bet: 50, mines: 3, rng: (n) => n - 1 });
  assert.throws(() => minesCashout(game), /au moins une case/);
  const once = minesReveal(game, game.bombs.includes(0) ? 1 : 0);
  assert.throws(() => minesReveal(once, once.revealed[0]), /déjà retournée/);
});

test("clearing every safe tile ends the round", () => {
  let game = { bet: 10, mines: 24, bombs: Array.from({ length: 24 }, (_, i) => i + 1), revealed: [], phase: "playing", hit: null };
  game = minesReveal(game, 0);
  assert.equal(game.phase, "cleared");
  assert.equal(minesNextMultiplier(game), null);
});

test("the crash multiplier climbs from 1.00", () => {
  assert.equal(crashMultiplierAt(0), 1);
  assert.equal(crashMultiplierAt(1), Math.round(GROWTH * 100) / 100);
  assert.ok(crashMultiplierAt(10) > crashMultiplierAt(9));
});

test("the crash point stays at or above 1 and keeps the house edge", () => {
  assert.equal(drawCrashPoint(() => 0), 1, "le tirage le plus bas écrase la manche");
  assert.ok(drawCrashPoint(() => 0.5) >= 1.9);
  assert.ok(drawCrashPoint(() => 0.999999) <= 1000);
  assert.throws(() => drawCrashPoint(() => 1), /Tirage invalide/);
});

test("cashing out before the crash pays, and after it pays nothing", () => {
  const game = newCrashGame({ bet: 100, uniform: () => 0.9 });
  assert.ok(game.crashPoint >= 9);
  const cashed = crashCashout(crashAdvance(crashAdvance(game)));
  assert.equal(cashed.phase, "cashed");
  assert.equal(crashPayout(cashed), Math.floor(100 * cashed.cashedAt));

  let blown = newCrashGame({ bet: 100, uniform: () => 0 });
  blown = crashAdvance(blown);
  assert.equal(blown.phase, "crashed");
  assert.equal(crashPayout(blown), 0);
  assert.throws(() => crashCashout(blown), /déjà terminée/);
});

test("the automatic cashout fires on its own", () => {
  let game = newCrashGame({ bet: 100, uniform: () => 0.95, autoCashout: 1.5 });
  while (game.phase === "running") game = crashAdvance(game);
  assert.equal(game.phase, "cashed");
  assert.ok(game.cashedAt >= 1.5);
  assert.throws(() => newCrashGame({ bet: 10, uniform: () => 0.5, autoCashout: 1 }), /1.01/);
});

test("a plinko ball lands in one of the buckets", () => {
  const left = dropPlinko(() => 0);
  assert.equal(left.bucket, 0);
  assert.equal(left.path.length, 16);
  const right = dropPlinko(() => 1);
  assert.equal(right.bucket, 16);
  const mixed = dropPlinko(seq([0, 1]));
  assert.equal(mixed.bucket, 8);
});

test("plinko pays the edges and takes the middle", () => {
  assert.equal(resolvePlinko({ bet: 100, risk: "moyen", bucket: 0 }).payout, 11000);
  assert.equal(resolvePlinko({ bet: 100, risk: "moyen", bucket: 8 }).payout, 30);
  assert.equal(resolvePlinko({ bet: 100, risk: "fort", bucket: 16 }).payout, 100000);
  assert.throws(() => resolvePlinko({ bet: 100, risk: "extreme", bucket: 0 }), /Risque invalide/);
  assert.throws(() => resolvePlinko({ bet: 100, risk: "moyen", bucket: 17 }), /arrivée invalide/);
});

test("every plinko table is symmetric and covers each bucket", () => {
  for (const [risk, table] of Object.entries(RISK_TABLES)) {
    assert.equal(table.length, BUCKETS, `${risk} doit couvrir toutes les cases`);
    assert.deepEqual(table, [...table].reverse(), `${risk} doit être symétrique`);
  }
});
