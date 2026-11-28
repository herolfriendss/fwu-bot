import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { botStates, commandCenterData, formatCommandCenter } from "./staff-command-center.js";
import { closeIntervention, openIntervention } from "./staff-interventions.js";
import { createMission, planMeeting } from "./staff-missions.js";
import { startOnCall } from "./staff-availability.js";

const PROFILES = [{ id: "fwu", label: "Bot principal" }, { id: "guard", label: "GUARD" }, { id: "investplus", label: "Invest +", optional: true }];

test("works on an empty server: missing tables never break the screen", () => {
  const db = new DatabaseSync(":memory:");
  const d = commandCenterData("g", { db, profiles: PROFILES });
  const text = formatCommandCenter(d);
  assert.match(text, /Centre de commandement/);
  assert.match(text, /Tickets ouverts : —/);
  assert.doesNotMatch(text, /FWU/);
});

test("gathers every section for this server only", () => {
  const db = new DatabaseSync(":memory:");
  const now = 10 * 86_400_000;
  db.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT, user_id TEXT, subject TEXT, status TEXT, claimed_by TEXT, created_at INTEGER, closed_at INTEGER);
    INSERT INTO tickets(guild_id, channel_id, user_id, subject, status, claimed_by, created_at) VALUES ('g','c1','u','a','open',NULL,0), ('g','c2','u','b','open','s',0), ('g2','c3','u','c','open',NULL,0), ('g','c4','u','d','closed',NULL,0);
    CREATE TABLE guardian_review_queue (guild_id TEXT, status TEXT); INSERT INTO guardian_review_queue VALUES ('g','pending'), ('g','cleared');
    CREATE TABLE moderation_appeals (guild_id TEXT, status TEXT); INSERT INTO moderation_appeals VALUES ('g','pending');
    CREATE TABLE bot_domain_leases (domain TEXT, holder TEXT, expires_at INTEGER, renewed_at INTEGER); INSERT INTO bot_domain_leases VALUES ('fwu','h',${now + 1000},0);
    CREATE TABLE bot_gateway_failures (profile TEXT, stopped INTEGER); INSERT INTO bot_gateway_failures VALUES ('guard', 1);`);
  openIntervention({ guildId: "g", actorId: "a", title: "Raid", priority: "haute" }, { db, now: 0 });
  openIntervention({ guildId: "g", actorId: "a", title: "Plainte" }, { db, now: now - 1000 });
  closeIntervention({ guildId: "g", number: 2, actorId: "a", resolution: "ok" }, { db, now });
  createMission({ guildId: "g", actorId: "s", title: "Retard", assigneeId: "m", dueAt: now - 1 }, { db, now: 0 });
  planMeeting({ guildId: "g", actorId: "s", topic: "Point", channelId: "c", startsAt: now + 3_600_000 }, { db, now });
  startOnCall("g", "m", 3_600_000, { db, now });
  const d = commandCenterData("g", { staffIds: ["m", "x"], absentIds: new Set(["x"]), db, now, profiles: PROFILES });
  assert.equal(d.tickets, 2);
  assert.equal(d.unclaimedTickets, 1);
  assert.equal(d.guardian, 1);
  assert.equal(d.appeals, 1);
  assert.deepEqual(d.reach.onCall, ["m"]);
  assert.equal(d.stale.length, 1);
  const text = formatCommandCenter(d);
  assert.match(text, /Interventions ouvertes : 1 \(🔴 n°1\)/);
  assert.match(text, /Sans nouvelle depuis 48 h : n°1/);
  assert.match(text, /Missions en retard : n°1 \(<@m>\)/);
  assert.match(text, /Point/);
  assert.match(text, /🟢 Bot principal · ⛔ GUARD/);
  assert.doesNotMatch(text, /Invest/); // optional bot never installed
});

test("bot states: lease, definitive stop, deliberate wait", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE bot_gateway_waits (profile TEXT, until INTEGER, reason TEXT); INSERT INTO bot_gateway_waits VALUES ('guard', 500, 'x');`);
  assert.deepEqual(botStates(db, 100, PROFILES).map((b) => b.state), ["down", "waiting", "absent"]);
});
