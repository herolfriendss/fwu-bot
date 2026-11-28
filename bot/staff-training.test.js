import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { answerExercise, certify, formatExercise, SCENARIOS, startExercise, trainingRecord } from "./staff-training.js";

const mem = () => new DatabaseSync(":memory:");
const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");
const CATALOGUE = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS];

test("scenarios only cite commands that really exist (never invent a command)", () => {
  const roots = new Set(CATALOGUE.map((c) => c.name));
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    const text = JSON.stringify(sc);
    for (const [, cmd] of text.matchAll(/\/([a-z][a-z-]+)/g)) assert.ok(roots.has(cmd), `${name} cite /${cmd}`);
    for (const q of sc.questions) {
      assert.ok(q.answer >= 0 && q.answer < q.choices.length);
      assert.ok(q.choices.length <= 4);
    }
    assert.doesNotMatch(text, /FWU/);
  }
});

test("exercise: only the trainee answers, once, with the explained correction", () => {
  const db = mem();
  const run = startExercise({ guildId: "g", traineeId: "t", trainerId: "s", scenario: "raid" }, { db });
  assert.match(formatExercise(run.id, run.scenario, "t"), /Simulation de raid/);
  assert.match(answerExercise({ guildId: "g", id: run.id, userId: "s", answers: "B,B,B,B" }, { db }).error, /Seul le stagiaire/);
  assert.match(answerExercise({ guildId: "g2", id: run.id, userId: "t", answers: "B,B,B,B" }, { db }).error, /introuvable/);
  assert.match(answerExercise({ guildId: "g", id: run.id, userId: "t", answers: "B,B" }, { db }).error, /4 lettres/);
  const result = answerExercise({ guildId: "g", id: run.id, userId: "t", answers: "b a b b" }, { db });
  assert.equal(result.score, 3);
  assert.equal(result.details.length, 4);
  assert.match(answerExercise({ guildId: "g", id: run.id, userId: "t", answers: "B,B,B,B" }, { db }).error, /déjà répondu/);
  assert.equal(trainingRecord("g", "t", { db }).exercises[0].score, 3);
  assert.match(startExercise({ guildId: "g", traineeId: "t", trainerId: "s", scenario: "x" }, { db }).error, /inconnu/);
});

test("certification: manager only, never self, only a completed track, once", () => {
  const db = mem();
  const track = { trackId: "abc", title: "Modérateur débutant" };
  const done = { complete: true, completedSteps: [0, 1], stepCount: 2 };
  assert.match(certify({ guildId: "g", memberId: "m", actorId: "x", canManage: false, track, progress: done }, { db }).error, /réservée/);
  assert.match(certify({ guildId: "g", memberId: "s", actorId: "s", canManage: true, track, progress: done }, { db }).error, /propre formation/);
  assert.match(certify({ guildId: "g", memberId: "m", actorId: "s", canManage: true, track, progress: { complete: false, completedSteps: [0], stepCount: 2 } }, { db }).error, /1\/2/);
  assert.ok(certify({ guildId: "g", memberId: "m", actorId: "s", canManage: true, track, progress: done }, { db }).ok);
  assert.match(certify({ guildId: "g", memberId: "m", actorId: "s", canManage: true, track, progress: done }, { db }).error, /déjà certifié/);
  assert.equal(trainingRecord("g", "m", { db }).certifications.length, 1);
  assert.equal(trainingRecord("g2", "m", { db }).certifications.length, 0);
});
