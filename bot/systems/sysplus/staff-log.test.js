import test from "node:test";
import assert from "node:assert/strict";
import { STAFF_LOG, addLogEntry, formatLog, readLog, removeLogEntry } from "./staff-log.js";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

test("ajout : texte propre, bornes, 30 par jour et par auteur", () => {
  assert.throws(() => addLogEntry({ guildId: "g", authorId: "a", body: "   ", now: NOW }), /quelque chose/);
  assert.throws(() => addLogEntry({ guildId: "g", authorId: "a", body: "x".repeat(STAFF_LOG.maxLength + 1), now: NOW }), /400/);
  const id = addLogEntry({ guildId: "g", authorId: "a", body: "Raid\n repoussé   à 22 h", now: NOW });
  assert.equal(readLog("g", { now: NOW + 1 })[0].body, "Raid repoussé à 22 h");
  for (let i = 1; i < STAFF_LOG.perAuthorPerDay; i++) addLogEntry({ guildId: "g", authorId: "a", body: `e${i}`, now: NOW + i });
  assert.throws(() => addLogEntry({ guildId: "g", authorId: "a", body: "de trop", now: NOW + 100 }), /Trop/);
  assert.ok(id > 0);
});

test("lecture par période, retrait par l'auteur ou un admin, purge à 90 jours", () => {
  const old = addLogEntry({ guildId: "g2", authorId: "b", body: "vieille entrée", now: NOW - 5 * DAY });
  const recent = addLogEntry({ guildId: "g2", authorId: "b", body: "récente", now: NOW });
  assert.deepEqual(readLog("g2", { days: 2, now: NOW }).map((r) => r.id), [recent]);
  assert.deepEqual(readLog("g2", { days: 10, now: NOW }).map((r) => r.id), [old, recent]);
  assert.throws(() => removeLogEntry({ guildId: "g2", id: recent, actorId: "c" }), /auteur ou un admin/);
  assert.equal(removeLogEntry({ guildId: "g2", id: recent, actorId: "c", isAdmin: true }), true);
  assert.throws(() => removeLogEntry({ guildId: "g2", id: recent, actorId: "b" }), /introuvable/);
  addLogEntry({ guildId: "g3", authorId: "d", body: "déclenche la purge", now: NOW + STAFF_LOG.retentionMs + 10 * DAY });
  assert.deepEqual(readLog("g2", { days: 30, now: NOW + STAFF_LOG.retentionMs + 10 * DAY }), []);
  assert.match(formatLog([], 2), /vide/);
  assert.match(formatLog([{ id: 4, author_id: "u", body: "ok", created_at: NOW }], 2), /`#4`.*<@u> : ok/);
});
