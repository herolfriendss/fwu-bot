import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  activeOnCall, availabilityOf, endOnCall, expireOnCall, formatSlots, isWithinSlots, MAX_ON_CALL_MS,
  onCallTotals, parisClock, parseSlots, reachableStaff, saveAvailability, startOnCall,
} from "./staff-availability.js";

const H = 3_600_000;
const mem = () => new DatabaseSync(":memory:");
// Mercredi 25/11/2026 20:00 à Paris (UTC+1) = 19:00 UTC.
const WED_20H = Date.UTC(2026, 10, 25, 19, 0);

test("slots: day ranges, lists, keywords, hours past midnight", () => {
  assert.deepEqual(parseSlots("lun-ven 18-23").slots.map((s) => s.day), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseSlots("sam 14h-2h").slots, [{ day: 6, start: 840, end: 120 }]);
  assert.deepEqual(parseSlots("dim 9:30-12").slots, [{ day: 0, start: 570, end: 720 }]);
  assert.deepEqual(parseSlots("ven-lun 20-23").slots.map((s) => s.day), [5, 6, 0, 1]);
  assert.equal(parseSlots("weekend 10-12, semaine 19-22").slots.length, 7);
  assert.equal(parseSlots("tous 8-9").slots.length, 7);
  assert.deepEqual(parseSlots("aucun").slots, []);
});

test("slots: clear errors instead of guessing", () => {
  assert.match(parseSlots("").error, /au moins un créneau/);
  assert.match(parseSlots("lundi soir").error, /illisible/);
  assert.match(parseSlots("lnu 18-23").error, /Jours illisibles/);
  assert.match(parseSlots("lun 25-26").error, /Heures illisibles/);
  assert.match(parseSlots("lun 18-18").error, /Heures illisibles/);
  assert.match(parseSlots("tous 1-2, tous 3-4, tous 5-6, tous 7-8").error, /Trop de créneaux/);
});

test("Paris clock and slot matching, including after midnight", () => {
  assert.deepEqual(parisClock(WED_20H), { day: 3, minute: 20 * 60 });
  const slots = parseSlots("mer 18-23, sam 22-2").slots;
  assert.equal(isWithinSlots(slots, { day: 3, minute: 20 * 60 }), true);
  assert.equal(isWithinSlots(slots, { day: 3, minute: 23 * 60 }), false);
  assert.equal(isWithinSlots(slots, { day: 6, minute: 23 * 60 }), true);
  assert.equal(isWithinSlots(slots, { day: 0, minute: 60 }), true);
  assert.equal(isWithinSlots(slots, { day: 0, minute: 3 * 60 }), false);
  assert.equal(formatSlots(parseSlots("lun-ven 18-23").slots), "lun mar mer jeu ven 18h-23h");
});

test("availability is stored per server and per member", () => {
  const db = mem();
  saveAvailability("g1", "u1", parseSlots("lun 18-20").slots, { db });
  assert.equal(availabilityOf("g1", "u1", { db }).length, 1);
  assert.deepEqual(availabilityOf("g2", "u1", { db }), []);
  saveAvailability("g1", "u1", [], { db });
  assert.deepEqual(availabilityOf("g1", "u1", { db }), []);
});

test("on call: bounded duration, stored expiry survives a restart, history kept", () => {
  const db = mem();
  const until = startOnCall("g1", "u1", 30 * 24 * H, { db, now: 0 });
  assert.equal(until, MAX_ON_CALL_MS);
  assert.equal(activeOnCall("g1", { db, now: H }).length, 1);
  assert.equal(activeOnCall("g2", { db, now: H }).length, 0);
  // New process: nothing in memory, the stored expiry still closes the shift.
  assert.equal(expireOnCall({ db, now: MAX_ON_CALL_MS + 1 }), 1);
  assert.equal(activeOnCall("g1", { db, now: MAX_ON_CALL_MS + 1 }).length, 0);
  assert.equal(onCallTotals("g1", 0, { db, now: MAX_ON_CALL_MS + 1 }).get("u1"), MAX_ON_CALL_MS);
  assert.equal(endOnCall("g1", "u1", { db }), false);
});

test("reachable staff: on call first, then slots, absent members left out", () => {
  const db = mem();
  saveAvailability("g1", "a", parseSlots("mer 18-23").slots, { db });
  saveAvailability("g1", "b", parseSlots("jeu 18-23").slots, { db });
  saveAvailability("g1", "c", parseSlots("mer 18-23").slots, { db });
  startOnCall("g1", "d", 2 * H, { db, now: WED_20H });
  const r = reachableStaff("g1", ["a", "b", "c", "d", "e"], { absentIds: new Set(["c"]), db, now: WED_20H });
  assert.deepEqual(r, { onCall: ["d"], available: ["a"], declaredNone: ["e"] });
});
