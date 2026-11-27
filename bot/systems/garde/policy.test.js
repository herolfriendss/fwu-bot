import test from "node:test";
import assert from "node:assert/strict";
import { appealOutcome, countBy, formatDuration, nextSanction, nextWeeklyReport } from "./policy.js";

test("garde helpers", () => {
  const now = 100 * 86_400_000;
  assert.equal(nextSanction([], { now }).action, "Avertissement");
  const cases = [{ action: "warn", created_at: now - 1 }, { action: "tempmute", created_at: now - 2 }, { action: "note", created_at: now }, { action: "warn", created_at: 0 }];
  assert.deepEqual([nextSanction(cases, { now }).count, nextSanction(cases, { now }).action], [2, "Mute 24 h"]);
  assert.equal(nextSanction(Array(9).fill({ action: "ban", created_at: now }), { now }).action, "Bannissement définitif");
  assert.deepEqual(countBy([{ a: 1 }, { a: 2 }, { a: 1 }], (r) => r.a), [[1, 2], [2, 1]]);
  assert.equal(formatDuration(90 * 60_000), "1 h 30");
  assert.equal(appealOutcome(1, 0), "quorum");
  assert.equal(appealOutcome(2, 1), "pour");
  assert.equal(appealOutcome(1, 1), "contre");
  const sat = Date.UTC(2026, 10, 28, 12); // samedi
  assert.equal(new Date(nextWeeklyReport(sat)).toISOString(), "2026-11-29T19:00:00.000Z");
  assert.equal(new Date(nextWeeklyReport(Date.UTC(2026, 10, 29, 20))).toISOString(), "2026-12-06T19:00:00.000Z");
});

test("sanction end reminders: only temporary sanctions ending within 5 min, once", async () => {
  const { sanctionsEndingSoon } = await import("./commands.js");
  const now = 1_000_000_000;
  const rows = [
    { id: 1, created_at: now - 56 * 60_000, details_json: JSON.stringify({ durationMs: 60 * 60_000 }) },
    { id: 2, created_at: now - 10 * 60_000, details_json: JSON.stringify({ durationMs: 60 * 60_000 }) },
    { id: 3, created_at: now - 59 * 60_000, details_json: JSON.stringify({}) },
    { id: 4, created_at: now - 58 * 60_000, details_json: JSON.stringify({ durationSeconds: 3600 }) },
  ];
  assert.deepEqual(sanctionsEndingSoon(rows, { now }).map((r) => r.id), [1, 4]);
  assert.deepEqual(sanctionsEndingSoon(rows, { now, sent: new Set([1]) }).map((r) => r.id), [4]);
});
