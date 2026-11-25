import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStaffStats, staffStatsEmbed } from "./staff-stats.js";

const T = 1_700_000_000_000;

test("stats du staff : sanctions par type, tickets, vocal, inactifs signalés, simples membres ignorés", () => {
  const rows = buildStaffStats({
    staffIds: ["m1", "m2", "m3"],
    central: {
      sanctions: [{ userId: "m1", action: "warn", count: 3, last: T }, { userId: "m1", action: "ban", count: 1, last: T + 5 }, { userId: "x9", action: "kick", count: 1, last: T }],
      usage: [{ userId: "m1", count: 10, last: T + 9 }, { userId: "m2", count: 2, last: T }, { userId: "membre", count: 50, last: T }],
      violations: [{ userId: "m1", count: 2 }],
    },
    local: { tickets: [{ userId: "m2", count: 4 }], voice: [{ userId: "m1", minutes: 95 }] },
  });
  assert.deepEqual(rows.map((r) => r.userId), ["m1", "m2", "x9", "m3"]);
  assert.deepEqual(rows[0].sanctions, { warn: 3, ban: 1 });
  assert.equal(rows[0].refusals, 2);
  assert.equal(rows[0].last, T + 9);
  assert.equal(rows.find((r) => r.userId === "m3").inactive, true);
  assert.equal(rows.find((r) => r.userId === "x9").staff, false, "a sanctionné sans être staff : affiché, marqué");
  assert.ok(!rows.some((r) => r.userId === "membre"));
  const text = staffStatsEmbed(rows, { days: 7, centralAvailable: true }).toJSON().description;
  assert.match(text, /<@m1> · ⚠️3 🔨1 · 🎫 0 · 🎙️ 1 h 35 · ⌨️ 10 · ⛔ 2 refus de quota/);
  assert.match(text, /Inactifs sur 7 j\*\* \(1\) : <@m3>/);
  assert.match(text, /\(hors staff\)/);
});

test("stats du staff : base centrale injoignable signalée", () => {
  const rows = buildStaffStats({ staffIds: ["m1"], central: null, local: { tickets: [], voice: [] } });
  assert.match(staffStatsEmbed(rows, { days: 30, centralAvailable: false }).toJSON().description, /Base centrale injoignable/);
});
