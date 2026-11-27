import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../database.js";
import { COUNTDOWN, countdownContent, remainingText, runCountdowns, startCountdown, stopCountdown } from "./event-countdown.js";

const NOW = 1_800_000_000_000;
const G = "123456789012345678";
const addEvent = (id, startsAt) => db.prepare("INSERT INTO events(id,guild_id,title,description,starts_at,host_id,channel_id,created_at) VALUES(?,?,?,?,?,?,?,?)").run(id, G, `Soirée ${id}`, "", startsAt, "h", "c", NOW);

test("temps restant lisible", () => {
  assert.equal(remainingText(0), "maintenant");
  assert.equal(remainingText(30_000), "moins d'une minute");
  assert.equal(remainingText(45 * 60_000), "45 min");
  assert.equal(remainingText(26 * 3_600_000 + 5 * 60_000), "1 j 2 h");
});

test("démarrage : événement futur seulement, un compte à rebours par événement", () => {
  assert.throws(() => startCountdown({ guildId: G, eventId: 99, channelId: "c" }, NOW), /introuvable/);
  addEvent(1, NOW + 2 * COUNTDOWN.dayMs);
  startCountdown({ guildId: G, eventId: 1, channelId: "c" }, NOW);
  assert.throws(() => startCountdown({ guildId: G, eventId: 1, channelId: "c" }, NOW), /déjà/);
  assert.equal(stopCountdown(G, 1), true);
  assert.equal(stopCountdown(G, 1), false);
  assert.match(countdownContent({ title: "T", description: "", starts_at: NOW + 3_600_000 }, 3, NOW), /Temps restant : \*\*1 h\*\* · inscrits : \*\*3\*\*/);
});

test("passage : message créé puis édité, rappels J-1 et H-1 une seule fois, figé au début", async () => {
  addEvent(2, NOW + 2 * COUNTDOWN.dayMs);
  db.prepare("INSERT INTO event_signups(guild_id,event_id,user_id,signed_up_at) VALUES('"+G+"',2,'u1',?)").run(NOW);
  startCountdown({ guildId: G, eventId: 2, channelId: "c" }, NOW);
  const sent = []; const edits = [];
  const message = { id: "m1", edit: async (p) => edits.push(p.content) };
  const channel = { send: async (p) => { sent.push(p.content); return message; }, messages: { fetch: async () => message } };
  const guild = { id: G, channels: { cache: new Map([["c", channel]]) } };
  const client = { guilds: { cache: new Map([[G, guild]]) } };
  const start = NOW + 2 * COUNTDOWN.dayMs;
  await runCountdowns(client, { now: NOW });
  assert.equal(sent.length, 1, "message initial");
  await runCountdowns(client, { now: start - COUNTDOWN.dayMs + 1000 });
  assert.match(sent.at(-1), /demain.*<@u1>/s);
  await runCountdowns(client, { now: start - COUNTDOWN.dayMs + 2000 });
  assert.equal(sent.filter((t) => t.includes("demain")).length, 1, "J-1 une seule fois");
  await runCountdowns(client, { now: start - COUNTDOWN.hourMs + 1000 });
  assert.match(sent.at(-1), /moins d'une heure/);
  assert.ok(edits.length >= 1);
  await runCountdowns(client, { now: start + 1000 });
  assert.match(edits.at(-1), /a commencé.*1 inscrit/);
  assert.equal(db.prepare("SELECT status FROM event_countdowns WHERE event_id=2").get().status, "done");
});
