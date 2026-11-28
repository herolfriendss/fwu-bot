import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  claimJobs, completeJob, deadJobs, enqueueJob, failJob, LEASE_MS, MAX_ATTEMPTS, pruneJobs,
  queueStats, retryDeadJob, retryDelayMs, runJobs,
} from "./core-queue.js";

const G = "111111111111111111";
const mem = () => new DatabaseSync(":memory:");

test("idempotency: the same key on the same server never creates two jobs", () => {
  const db = mem();
  const a = enqueueJob({ guildId: G, target: "fisc", kind: "economy.credit", payload: { amount: 50 }, source: "arcade", idempotencyKey: "quiz:42:winner" }, { db });
  const b = enqueueJob({ guildId: G, target: "fisc", kind: "economy.credit", payload: { amount: 50 }, source: "arcade", idempotencyKey: "quiz:42:winner" }, { db });
  assert.equal(a.id, b.id);
  assert.equal(b.duplicate, true);
  const other = enqueueJob({ guildId: "222222222222222222", target: "fisc", kind: "economy.credit", source: "arcade", idempotencyKey: "quiz:42:winner" }, { db });
  assert.notEqual(other.id, a.id);
  assert.throws(() => enqueueJob({ guildId: "x", target: "fisc", kind: "test.job", source: "s" }, { db }), /Serveur invalide/);
  assert.throws(() => enqueueJob({ guildId: G, target: "Fisc!", kind: "test.job", source: "s" }, { db }), /Destinataire/);
});

test("a job waits for its bot, is leased by one holder, and only that holder finishes it", () => {
  const db = mem();
  const { id } = enqueueJob({ guildId: G, target: "dispatch", kind: "notify.dm", source: "event" }, { db, now: 0 });
  assert.deepEqual(claimJobs("fisc", "h0", { db, now: 1 }), []); // other bots do not see it
  const [job] = claimJobs("dispatch", "h1", { db, now: 1 });
  assert.equal(job.id, id);
  assert.deepEqual(claimJobs("dispatch", "h2", { db, now: 2 }), []); // leased
  assert.equal(completeJob(id, "h2", { db, now: 3 }), false);
  assert.equal(completeJob(id, "h1", { db, now: 3 }), true);
  assert.deepEqual(claimJobs("dispatch", "h2", { db, now: LEASE_MS * 2 }), []);
});

test("a crashed holder's job comes back after the lease, never lost", () => {
  const db = mem();
  enqueueJob({ guildId: G, target: "fisc", kind: "test.job", source: "s" }, { db, now: 0 });
  claimJobs("fisc", "crashed", { db, now: 0 });
  assert.deepEqual(claimJobs("fisc", "new", { db, now: LEASE_MS - 1 }), []);
  const [again] = claimJobs("fisc", "new", { db, now: LEASE_MS });
  assert.equal(again.attempts, 2);
  assert.equal(completeJob(again.id, "crashed", { db }), false); // the late holder cannot overwrite
});

test("failures retry with a growing pause, then become dead and can be retried by the staff", () => {
  const db = mem();
  const { id } = enqueueJob({ guildId: G, target: "fisc", kind: "test.job", source: "s" }, { db, now: 0 });
  let now = 0;
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const [job] = claimJobs("fisc", "h", { db, now });
    assert.equal(failJob(job.id, "h", new Error("Discord indisponible"), { db, now }), "retry");
    now += retryDelayMs(i);
  }
  const [last] = claimJobs("fisc", "h", { db, now });
  assert.equal(failJob(last.id, "h", new Error(`token ${["MTIz", "NDU2Nzg5MDEyMzQ1Njc4OTAx"].join("")}.${"GaBcDe"}.${"abcdefghijklmnop" + "qrstuvwxyz0123"}`), { db, now }), "dead");
  const [dead] = deadJobs({ db });
  assert.equal(dead.id, id);
  assert.doesNotMatch(dead.last_error, /abcdefghijklmnop/); // never keep a token-like secret
  assert.deepEqual(claimJobs("fisc", "h", { db, now: now + 10 * 3_600_000 }), []);
  assert.equal(retryDeadJob(id, { db, now }), true);
  assert.equal(claimJobs("fisc", "h", { db, now }).length, 1);
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(30), 3_600_000);
});

test("runJobs: handlers, permanent errors, unknown kinds kept for a newer version, server filter", async () => {
  const db = mem();
  enqueueJob({ guildId: G, target: "fisc", kind: "ok", source: "s" }, { db, now: 0 });
  enqueueJob({ guildId: G, target: "fisc", kind: "bad", source: "s" }, { db, now: 0 });
  enqueueJob({ guildId: G, target: "fisc", kind: "future", source: "s" }, { db, now: 0 });
  enqueueJob({ guildId: "333333333333333333", target: "fisc", kind: "ok", source: "s" }, { db, now: 0 });
  const seen = [];
  const result = await runJobs("fisc", "h", {
    ok: (job) => seen.push(job.guildId),
    bad: () => { throw Object.assign(new Error("montant invalide"), { permanent: true }); },
  }, { db, now: 1, guildIds: [G] });
  assert.deepEqual(result, { done: 1, retry: 1, dead: 1 });
  assert.deepEqual(seen, [G]);
  const stats = queueStats({ db, guildId: G });
  assert.deepEqual(stats.find((s) => s.status === "pending")?.count, 1);
  assert.equal(pruneJobs({ db, now: 20 * 86_400_000 }), 1);
});
