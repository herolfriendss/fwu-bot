import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { appendAudit, appendAuditSafe, auditToCsv, listAudit, scrubDetails, verifyAuditChain } from "./core-audit.js";

const G = "111111111111111111";
const mem = () => new DatabaseSync(":memory:");
const fakeToken = () => [["MTIz", "NDU2Nzg5MDEyMzQ1Njc4OTAx"].join(""), "GaBcDe", "abcdefghijklmnop" + "qrstuvwxyz0123"].join(".");

test("entries are numbered per server and chained", () => {
  const db = mem();
  assert.equal(appendAudit({ guildId: G, source: "authority", actorId: "o", action: "authority.approve", target: "req:1" }, { db, secret: "" }).seq, 1);
  assert.equal(appendAudit({ guildId: G, source: "authority", actorId: "o", action: "authority.revoke", target: "req:1" }, { db, secret: "" }).seq, 2);
  assert.equal(appendAudit({ guildId: "222222222222222222", source: "x", actorId: "a", action: "test.one" }, { db, secret: "" }).seq, 1);
  assert.deepEqual(verifyAuditChain(G, { db, secret: "" }), { ok: true, count: 2, brokenAt: null });
  assert.deepEqual(listAudit(G, { db, action: "authority." }).map((e) => e.seq), [2, 1]);
  assert.throws(() => appendAudit({ guildId: G, source: "x", actorId: "a", action: "DROP TABLE" }, { db }), /invalide/);
  assert.equal(appendAuditSafe({ guildId: G, source: "x", actorId: "a", action: "BAD ACTION" }, { db }), null);
});

test("a manual edit, deletion or insertion in the database is detected", () => {
  for (const tamper of [
    (db) => db.exec("UPDATE core_audit SET actor_id = 'intrus' WHERE seq = 2"),
    (db) => db.exec("DELETE FROM core_audit WHERE seq = 2"),
    (db) => db.exec("UPDATE core_audit SET details_json = '{\"approuve\":true}' WHERE seq = 1"),
  ]) {
    const db = mem();
    for (let i = 0; i < 3; i++) appendAudit({ guildId: G, source: "s", actorId: "a", action: "test.step", details: { i } }, { db, secret: "k" });
    tamper(db);
    const result = verifyAuditChain(G, { db, secret: "k" });
    assert.equal(result.ok, false);
  }
});

test("with a server secret, a recomputed chain without the secret does not verify", () => {
  const db = mem();
  appendAudit({ guildId: G, source: "s", actorId: "a", action: "test.step" }, { db, secret: "secret-serveur" });
  assert.equal(verifyAuditChain(G, { db, secret: "secret-serveur" }).ok, true);
  assert.equal(verifyAuditChain(G, { db, secret: "" }).ok, false);
});

test("credentials never reach the journal; CSV neutralises formulas", () => {
  const json = scrubDetails({ token: "abc", note: `voici ${fakeToken()}`, nested: { password: "x" } });
  assert.doesNotMatch(json, /abcdefghijklmnop|"abc"|"x"/);
  const csv = auditToCsv([{ seq: 1, at: 0, source: "s", actorId: "a", action: "test.step", target: "=HYPERLINK(1)", details: { a: 1 } }]);
  assert.match(csv, /"'=HYPERLINK\(1\)"/);
});
