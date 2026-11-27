import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../database.js";
import { DROP, claimDrop, configureDrop, dropConfig, forgetActivity, handleDropButton, noteActivity, pickChannel, runPndDrops } from "./pnd-drop.js";

const msg = (channelId, userId) => ({ guild: { id: "g" }, channelId, author: { id: userId, bot: false } });
const T = 10 * 3_600_000;

test("salon actif : 5 messages de 3 membres sur 10 min, le plus animé gagne", () => {
  forgetActivity();
  for (const u of ["a", "b", "a", "b", "a"]) noteActivity(msg("calme", u), T);
  for (const u of ["a", "b", "c", "a", "b", "c", "a"]) noteActivity(msg("actif", u), T);
  assert.equal(pickChannel(["calme"], T), null, "seulement 2 membres");
  assert.equal(pickChannel(["calme", "actif"], T), "actif");
  assert.equal(pickChannel(["actif"], T + DROP.windowMs + 1), null, "activité trop ancienne");
  noteActivity({ ...msg("actif", "bot"), author: { id: "bot", bot: true } }, T);
});

test("largage : planifié, un coffre, premier clic gagne, pas deux coffres de suite, expiration", async () => {
  forgetActivity();
  for (const u of ["a", "b", "c", "a", "b"]) noteActivity(msg("c1", u), T);
  assert.throws(() => configureDrop("g", { min: 500, max: 100 }, T), /Montants/);
  configureDrop("g", { enabled: true, min: 100, max: 100 }, T);
  const sent = []; const edits = [];
  const channel = { send: async (p) => { sent.push(p); return { id: "m1" }; }, messages: { fetch: async () => ({ edit: async (p) => edits.push(p) }) }, isTextBased: () => true, guild: { id: "g" } };
  const guild = { id: "g", channels: { cache: new Map([["c1", channel]]) } };
  const client = { guilds: { cache: new Map([["g", guild]]) }, channels: { cache: new Map([["c1", channel]]) } };
  assert.deepEqual(await runPndDrops(client, { now: T, channelsOf: () => ["c1"] }), [], "pas avant 2 h");
  for (const u of ["a", "b", "c", "a", "b"]) noteActivity(msg("c1", u), T + DROP.minGapMs);
  const dropped = await runPndDrops(client, { now: T + DROP.minGapMs, rand: () => 0, channelsOf: () => ["c1"] });
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].amount, 100);
  assert.ok(dropConfig("g").nextAt >= T + 2 * DROP.minGapMs);
  const id = db.prepare("SELECT id FROM fisc_drops WHERE guild_id='g'").get().id;
  const first = claimDrop(id, "winner", T + DROP.minGapMs + 5);
  assert.equal(first.ok, true);
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id='g' AND user_id='winner'").get().balance, 100);
  assert.match(claimDrop(id, "late", T + DROP.minGapMs + 6).message, /plus rapide/);
  // second coffre : le dernier gagnant ne peut pas le reprendre
  const id2 = Number(db.prepare("INSERT INTO fisc_drops(guild_id,channel_id,amount,created_at) VALUES('g','c1',50,?)").run(T).lastInsertRowid);
  assert.match(claimDrop(id2, "winner", T + 1).message, /dernier coffre/);
  assert.equal(claimDrop(id2, "other", T + DROP.ttlMs + 1).ok, false, "expiré");
  const replies = [];
  assert.equal(await handleDropButton({ isButton: () => true, customId: "drop:claim:9999", user: { id: "x" }, reply: async (p) => replies.push(p) }), true);
  assert.match(replies[0].content, /introuvable/);
});
