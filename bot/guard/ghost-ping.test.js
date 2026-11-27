import test from "node:test";
import assert from "node:assert/strict";
import { GHOST, ghostMentions, ghostText, handleGhostPing, mentionsOf, noteGhost } from "./ghost-ping.js";

const NOW = 10_000_000;
function msg({ author = "a", bot = false, users = [], roles = [], everyone = false, age = 5_000, partial = false, guild = "g" } = {}) {
  const sent = [];
  return {
    partial, guild: { id: guild }, channelId: "c", createdTimestamp: NOW - age, author: { id: author, bot },
    mentions: { users: new Map(users.map((u) => [u.id ?? u, { id: u.id ?? u, bot: Boolean(u.bot) }])), roles: new Map(roles.map((r) => [r, {}])), everyone },
    channel: { send: async (p) => { sent.push(p); return p; } }, sent,
  };
}

test("mentions : membres hors bots et auteur, rôles, @everyone", () => {
  assert.deepEqual(mentionsOf(msg({ users: ["b", { id: "bot", bot: true }, "a"], roles: ["r"], everyone: true })), { users: ["b"], roles: ["r"], everyone: true });
});

test("suppression : signalée seulement si récente, avec mention, par un humain, message connu", () => {
  assert.deepEqual(ghostMentions(msg({ users: ["b"] }), null, NOW), { users: ["b"], roles: [], everyone: false });
  assert.equal(ghostMentions(msg({ users: ["b"], age: GHOST.windowMs + 1 }), null, NOW), null);
  assert.equal(ghostMentions(msg({}), null, NOW), null);
  assert.equal(ghostMentions(msg({ users: ["b"], bot: true }), null, NOW), null);
  assert.equal(ghostMentions(msg({ users: ["b"], partial: true }), null, NOW), null);
  assert.equal(ghostMentions(null), null);
});

test("modification : seules les mentions retirées comptent", () => {
  assert.deepEqual(ghostMentions(msg({ users: ["b", "c"] }), msg({ users: ["c"] }), NOW), { users: ["b"], roles: [], everyone: false });
  assert.equal(ghostMentions(msg({ users: ["b"] }), msg({ users: ["b"] }), NOW), null);
});

test("anti-spam : un avis par auteur toutes les 30 s, compteur sur 10 min", () => {
  assert.deepEqual(noteGhost("g2", "x", NOW), { notify: true, count: 1 });
  assert.deepEqual(noteGhost("g2", "x", NOW + 1_000), { notify: false, count: 2 });
  assert.deepEqual(noteGhost("g2", "x", NOW + GHOST.authorCooldownMs + 1), { notify: true, count: 3 });
  assert.equal(noteGhost("g2", "x", NOW + GHOST.repeatWindowMs * 2).count, 1);
});

test("avis dans le salon sans re-mentionner, journal, désactivable", async () => {
  const m = msg({ author: "z", users: ["b"], roles: ["r"], guild: "g3" });
  const logs = [];
  assert.equal(await handleGhostPing(m, null, { now: NOW, sendLog: async (t) => logs.push(t) }), true);
  assert.equal(m.sent.length, 1);
  assert.deepEqual(m.sent[0].allowedMentions, { parse: [] });
  assert.match(m.sent[0].content, /<@z> a mentionné <@b>, <@&r> puis a supprimé son message/);
  assert.match(logs[0], /Salon : <#c>/);
  assert.equal(await handleGhostPing(msg({ users: ["b"], guild: "g4" }), null, { now: NOW, env: { PND_GHOST_PING: "off" } }), false);
  assert.match(ghostText("a", { users: [], roles: [], everyone: true }, true), /@everyone puis a retiré la mention/);
});
