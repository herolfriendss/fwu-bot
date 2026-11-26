import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-smash-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const S = await import("./smash.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });
const G = "100000000000000001";

test("only adult volunteers take part; nobody can be rated without signing up", () => {
  assert.match(S.join(G, "a", false), /majeures/);
  assert.equal(S.isPlayer(G, "a"), false);
  S.join(G, "a", true); S.join(G, "b", true);
  assert.equal(S.nextTarget(G, "a"), "b");
  assert.throws(() => S.vote(G, "a", "c", "smash"), /ne participe plus/);
  assert.throws(() => S.vote(G, "c", "b", "smash"), /Inscris-toi/);
  assert.throws(() => S.vote(G, "a", "a", "smash"), /pour toi/);
});

test("votes are anonymous counters and each profile is shown once per voter", () => {
  S.vote(G, "a", "b", "smash");
  assert.deepEqual(S.score(G, "b"), { smash: 1, pass: 0 });
  assert.equal(S.nextTarget(G, "a"), null, "b already rated");
  S.vote(G, "a", "b", "pass");
  assert.deepEqual(S.score(G, "b"), { smash: 0, pass: 1 }, "a vote can change, never doubles");
});

test("3 reports suspend a profile pending staff review; leaving erases everything", () => {
  S.join(G, "c", true); S.join(G, "d", true); S.join(G, "e", true);
  assert.equal(S.report(G, "a", "b"), false);
  S.report(G, "a", "b");
  assert.equal(S.report(G, "c", "b"), false, "same reporter counts once");
  assert.equal(S.report(G, "d", "b"), true);
  assert.equal(S.isPlayer(G, "b"), false);
  S.leave(G, "a");
  assert.equal(S.isPlayer(G, "a"), false);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM smash_votes WHERE voter_id = 'a'").get().n), 0);
});
