import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-guardian-risk-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const api = await import("./guardian-risk.js");
const guildId = "123456";
const memberId = "234567";
const otherMemberId = "345678";
const reviewerId = "456789";
const base = 1_800_000_000_000;

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("message risk is idempotent, guild/member scoped, and creates a single human-review dossier", () => {
  const first = api.recordGuardianMessageRisk({ guildId, userId: memberId, messageId: "message-1", mentionCount: 8, linkCount: 0, rapidCount: 0, now: base });
  assert.equal(first.recorded, true);
  assert.equal(first.assessment.score, 30);
  assert.equal(first.review, null);

  const second = api.recordGuardianMessageRisk({ guildId, userId: memberId, messageId: "message-2", mentionCount: 0, linkCount: 3, rapidCount: 0, now: base + 1000 });
  assert.equal(second.assessment.score, 55);
  assert.equal(second.review.created, true);

  const replay = api.recordGuardianMessageRisk({ guildId, userId: memberId, messageId: "message-2", mentionCount: 0, linkCount: 3, rapidCount: 0, now: base + 1000 });
  assert.equal(replay.recorded, false);
  assert.equal(replay.review.created, false);
  assert.equal(api.listGuardianReviews(guildId).length, 1);
  assert.equal(api.listGuardianReviews("654321").length, 0);
  assert.equal(api.assessGuardianRisk(guildId, otherMemberId, base + 1000).score, 0);

  const columns = db.prepare("PRAGMA table_info(guardian_risk_signals)").all().map((row) => row.name);
  assert.equal(columns.includes("content"), false);
  assert.equal(columns.includes("url"), false);
});

test("human review closes only the current guild dossier and records reviewer metadata", () => {
  const signal = api.recordGuardianMessageRisk({ guildId, userId: otherMemberId, messageId: "burst-1", mentionCount: 0, linkCount: 0, rapidCount: 5, now: base + 2000 });
  const second = api.recordGuardianMessageRisk({ guildId, userId: otherMemberId, messageId: "burst-2", mentionCount: 0, linkCount: 0, rapidCount: 6, now: base + 3000 });
  assert.ok(second.review);
  const reviewId = second.review.id;
  const resolved = api.resolveGuardianReview({ guildId, reviewId, reviewerId, outcome: "cleared", note: "Faux positif", now: base + 4000 });
  assert.equal(resolved.status, "cleared");
  assert.equal(api.listGuardianReviews(guildId).some((row) => row.id === reviewId), false);
  const stored = db.prepare("SELECT status,reviewed_by,review_note FROM guardian_review_queue WHERE id=?").get(reviewId);
  assert.equal(stored.status, "cleared");
  assert.equal(stored.reviewed_by, reviewerId);
  assert.equal(stored.review_note, "Faux positif");
  assert.equal(api.pruneGuardianReviews(base + 5000), 1);
  assert.throws(() => api.resolveGuardianReview({ guildId: "654321", reviewId, reviewerId, outcome: "reviewed" }), /introuvable/i);
  assert.ok(signal.recorded);
});

test("Guardian review command requires staff permissions and performs no automatic sanction", async () => {
  const denied = [];
  const outsiderMessage = {
    content: "=guardian-review list", guild: { id: guildId, ownerId: "111111" },
    author: { id: memberId, bot: false }, member: { permissions: { has: () => false } },
    reply: async (payload) => denied.push(payload.content),
  };
  assert.equal(await api.handleGuardianReviewMessage(outsiderMessage), true);
  assert.match(denied[0], /réservée/i);

  const allowed = [];
  const staffMessage = {
    content: "=guardian-review list", guild: { id: guildId, ownerId: "111111" },
    author: { id: reviewerId, bot: false }, member: { permissions: { has: (permission) => permission === 32n } },
    reply: async (payload) => allowed.push(payload.content),
  };
  assert.equal(await api.handleGuardianReviewMessage(staffMessage), true);
  assert.match(allowed[0], /file de revue/i);
  assert.match(allowed[0], /aucune sanction n.*appliquée automatiquement/i);
});

test("risk retention removes old signal metadata only", () => {
  const retentionGuild = "567890";
  api.recordGuardianMessageRisk({ guildId: retentionGuild, userId: memberId, messageId: "old", mentionCount: 7, linkCount: 0, rapidCount: 0, now: base - 1000 });
  api.recordGuardianMessageRisk({ guildId: retentionGuild, userId: memberId, messageId: "new", mentionCount: 7, linkCount: 0, rapidCount: 0, now: base });
  assert.equal(api.pruneGuardianRiskSignals(base - 500), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM guardian_risk_signals WHERE guild_id=? AND user_id=?").get(retentionGuild, memberId).count, 1);
});
