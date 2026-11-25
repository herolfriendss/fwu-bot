import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRejectionCounter, describeRejection, installProcessGuard, rejectionLimits } from "./process-guard.js";

test("le compteur garde les rejets de la fenêtre et signale le dépassement", () => {
  const c = createRejectionCounter({ limit: 2, windowMs: 1000 });
  assert.equal(c.note({}, 0).overLimit, false);
  assert.equal(c.note({}, 100).overLimit, false);
  assert.equal(c.note({}, 200).overLimit, true);
  assert.deepEqual({ total: c.stats(5000).total, recent: c.stats(5000).recent }, { total: 3, recent: 0 });
});

test("l'origine d'une erreur : code et fichier du bot, sans node_modules", () => {
  const err = Object.assign(new Error("boom"), { code: 50013 });
  err.stack = "Error: boom\n    at x (/app/node_modules/discord.js/a.js:1:1)\n    at y (/home/opc/her/bot/music/music.js:42:7)";
  assert.deepEqual(describeRejection(err), { code: "50013", name: "Error", module: "music/music.js" });
  assert.deepEqual(describeRejection("texte"), { code: null, name: "string", module: null });
});

test("réglages par variables, valeurs par défaut sinon", () => {
  assert.deepEqual(rejectionLimits({}), { limit: 10, windowMs: 600000 });
  assert.deepEqual(rejectionLimits({ PND_REJECTION_LIMIT: "3", PND_REJECTION_WINDOW_MIN: "5" }), { limit: 3, windowMs: 300000 });
  assert.deepEqual(rejectionLimits({ PND_REJECTION_LIMIT: "-1" }), { limit: 10, windowMs: 600000 });
});

test("le filet note et écrit chaque rejet, puis arrête le bot au-delà du seuil (une seule fois)", async () => {
  const target = new EventEmitter();
  const codes = [];
  const written = [];
  const exits = [];
  installProcessGuard({ target, record: (c) => codes.push(c), stderr: (t) => written.push(t), exit: (c) => exits.push(c), env: { PND_REJECTION_LIMIT: "2" } });
  target.emit("unhandledRejection", Object.assign(new Error("Unknown Message"), { code: 10008 }));
  assert.equal(codes[0], "unhandled_rejection:10008");
  assert.match(written[0], /Unknown Message/, "l'erreur complète reste visible");
  target.emit("unhandledRejection", new Error("b"));
  target.emit("unhandledRejection", new Error("c"));
  target.emit("unhandledRejection", new Error("d"));
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(exits, [1]);
  assert.equal(codes.filter((c) => c === "unhandled_rejection_restart").length, 1);
});
