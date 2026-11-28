import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  addMinutes, cancelMeeting, createMission, finishMission, listMeetings, listMissions, missionTotals,
  overdueMissions, parseParisDate, planMeeting, takeDueMeetingReminders,
} from "./staff-missions.js";

const mem = () => new DatabaseSync(":memory:");
// 25/11/2026 20:00 Paris = 19:00 UTC (winter time).
const NOW = Date.UTC(2026, 10, 25, 19, 0);

test("Paris dates: absolute, relative, summer time, refusals", () => {
  assert.equal(parseParisDate("28/11 21h", NOW).at, Date.UTC(2026, 10, 28, 20, 0));
  assert.equal(parseParisDate("demain 20h30", NOW).at, Date.UTC(2026, 10, 26, 19, 30));
  assert.equal(parseParisDate("aujourd'hui 22:15", NOW).at, Date.UTC(2026, 10, 25, 21, 15));
  // January without a year, written in November: next year.
  assert.equal(parseParisDate("02/01 10h", NOW).at, Date.UTC(2027, 0, 2, 9, 0));
  // Summer time (UTC+2): 15/02/2027 is winter, check a June date within 90 days from April.
  const april = Date.UTC(2027, 3, 1, 10, 0);
  assert.equal(parseParisDate("15/06/2027 21h", april).at, Date.UTC(2027, 5, 15, 19, 0));
  assert.match(parseParisDate("aujourd'hui 10h", NOW).error, /passée/);
  assert.match(parseParisDate("31/02 10h", NOW).error, /n'existe pas/);
  assert.match(parseParisDate("bientôt", NOW).error, /illisible/);
  assert.match(parseParisDate("01/06/2027 10h", NOW).error, /90 jours/);
});

test("missions: individual or collective, visibility, completion rights, totals", () => {
  const db = mem();
  createMission({ guildId: "g", actorId: "sys", title: "Relire le règlement" }, { db, now: 1 });
  createMission({ guildId: "g", actorId: "sys", title: "Former Paul", assigneeId: "a", dueAt: 10 }, { db, now: 1 });
  createMission({ guildId: "g", actorId: "sys", title: "Privé de b", assigneeId: "b" }, { db, now: 1 });
  assert.deepEqual(listMissions("g", { userId: "a", db }).map((m) => m.number), [2, 1]);
  assert.equal(listMissions("g", { all: true, db }).length, 3);
  assert.equal(listMissions("g2", { all: true, db }).length, 0);
  assert.match(finishMission({ guildId: "g", number: 3, actorId: "a", report: "x" }, { db }).error, /quelqu'un d'autre/);
  assert.match(finishMission({ guildId: "g", number: 2, actorId: "a", report: " " }, { db }).error, /bilan/);
  assert.ok(finishMission({ guildId: "g", number: 2, actorId: "a", report: "Fait" }, { db, now: 5 }).ok);
  assert.match(finishMission({ guildId: "g", number: 2, actorId: "a", report: "Fait" }, { db }).error, /déjà terminée/);
  assert.match(finishMission({ guildId: "g", number: 1, actorId: "a", cancel: true }, { db }).error, /annulent/);
  assert.ok(finishMission({ guildId: "g", number: 1, actorId: "sys", cancel: true, canManage: true }, { db }).ok);
  assert.equal(missionTotals("g", 0, { db }).get("a"), 1);
  assert.deepEqual(overdueMissions("g", { db, now: 100 }), []);
});

test("meetings: one reminder 30 min before, even after a restart, minutes after the start", () => {
  const db = mem();
  const start = NOW + 2 * 3_600_000;
  assert.equal(planMeeting({ guildId: "g", actorId: "sys", topic: "Bilan du mois", channelId: "c1", startsAt: start }, { db, now: NOW }).number, 1);
  assert.match(planMeeting({ guildId: "g", actorId: "sys", topic: "x", channelId: "c1", startsAt: NOW - 1 }, { db, now: NOW }).error, /futur/);
  assert.deepEqual(takeDueMeetingReminders({ db, now: NOW }), []);
  const due = takeDueMeetingReminders({ db, now: start - 29 * 60_000 });
  assert.equal(due.length, 1);
  assert.equal(due[0].channel_id, "c1");
  assert.deepEqual(takeDueMeetingReminders({ db, now: start - 28 * 60_000 }), []); // never twice
  assert.match(addMinutes({ guildId: "g", number: 1, actorId: "a", text: "x" }, { db, now: NOW }).error, /commencée/);
  assert.ok(addMinutes({ guildId: "g", number: 1, actorId: "a", text: "Décisions : …" }, { db, now: start + 1 }).ok);
  assert.equal(listMeetings("g", { db, now: start + 1, past: true })[0].minutes, "Décisions : …");
  assert.match(cancelMeeting({ guildId: "g", number: 1, actorId: "x" }, { db }).error, /Seuls/);
  assert.ok(cancelMeeting({ guildId: "g", number: 1, actorId: "sys" }, { db }).ok);
});

test("a meeting missed while the bot was off long ago is not reminded late", () => {
  const db = mem();
  planMeeting({ guildId: "g", actorId: "s", topic: "Vieille", channelId: "c", startsAt: NOW + 3_600_000 }, { db, now: NOW });
  assert.deepEqual(takeDueMeetingReminders({ db, now: NOW + 5 * 3_600_000 }), []);
});
