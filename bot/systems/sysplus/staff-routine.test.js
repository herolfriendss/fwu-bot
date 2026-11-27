import test from "node:test";
import assert from "node:assert/strict";
import { configureRoutine, disableRoutine, inactiveToAlert, parisClock, routineConfig, STAFF_ROUTINE } from "./staff-routine.js";

test("horloge de Paris : jour de semaine, date, heure", () => {
  const monday = parisClock(Date.UTC(2026, 10, 23, 8, 30)); // lundi 23/11/2026, 9 h 30 à Paris
  assert.deepEqual(monday, { date: "2026-11-23", hour: 9, weekday: 1 });
  assert.equal(parisClock(Date.UTC(2026, 10, 22, 12)).weekday, 7);
});

test("config : salon obligatoire, désactivable", () => {
  assert.throws(() => configureRoutine("g", null), /salon/);
  assert.equal(routineConfig("g"), null);
  assert.equal(configureRoutine("g", "c").enabled, true);
  assert.equal(disableRoutine("g"), true);
  assert.equal(routineConfig("g").enabled, false);
});

test("inactifs à alerter : staff inactif seulement, pas deux fois en 14 jours", async () => {
  const { db } = await import("../../database.js");
  const rows = [{ userId: "a", staff: true, inactive: true }, { userId: "b", staff: true, inactive: false }, { userId: "c", staff: false, inactive: true }];
  assert.deepEqual(inactiveToAlert("g", rows, 1000).map((r) => r.userId), ["a"]);
  db.prepare("INSERT INTO sysplus_inactivity_alerts(guild_id,user_id,alerted_at) VALUES('g','a',1000)").run();
  assert.deepEqual(inactiveToAlert("g", rows, 1000 + 1000), []);
  assert.deepEqual(inactiveToAlert("g", rows, 1000 + STAFF_ROUTINE.realertMs).map((r) => r.userId), ["a"]);
});

test("passage : rapport le lundi dès 9 h, une seule fois par jour, rien avant 9 h", async () => {
  const { runStaffRoutine } = await import("./staff-routine.js");
  configureRoutine("g9", "c9");
  const sent = [];
  const channel = { send: async (p) => sent.push(p) };
  const guild = { id: "g9", members: { fetch: async () => null, cache: new Map() }, channels: { cache: new Map([["c9", channel]]) } };
  const client = { guilds: { cache: new Map([["g9", guild]]) } };
  assert.deepEqual(await runStaffRoutine(client, { now: Date.UTC(2026, 10, 23, 6, 0) }), { reports: 0, alerts: 0 }, "7 h à Paris");
  assert.equal((await runStaffRoutine(client, { now: Date.UTC(2026, 10, 23, 8, 30) })).reports, 1);
  assert.equal((await runStaffRoutine(client, { now: Date.UTC(2026, 10, 23, 9, 30) })).reports, 0, "déjà fait aujourd'hui");
  assert.equal((await runStaffRoutine(client, { now: Date.UTC(2026, 10, 24, 9, 30) })).reports, 0, "mardi : pas de rapport");
  assert.match(sent[0].content, /Rapport hebdomadaire/);
});
