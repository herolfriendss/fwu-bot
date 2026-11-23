import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-moderation-appeals-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { canReviewModerationAppeal, createSanctionAppeal, listPendingModerationAppeals, recordModerationCase, reviewModerationAppeal } = await import("./moderation.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("sanction appeals enforce ownership, guild scope, allowed actions, and the seven-day window", () => {
  const recent = recordModerationCase({ guildId: "guild-a", userId: "member-a", moderatorId: "staff", action: "warn", reason: "spam" });
  const otherGuild = recordModerationCase({ guildId: "guild-b", userId: "member-a", moderatorId: "staff", action: "ban", reason: "other" });
  const old = recordModerationCase({ guildId: "guild-a", userId: "member-a", moderatorId: "staff", action: "ban", reason: "old" });
  const unmute = recordModerationCase({ guildId: "guild-a", userId: "member-a", moderatorId: "staff", action: "unmute", reason: "not appealable" });
  db.prepare("UPDATE moderation_cases SET created_at=? WHERE id=?").run(Date.now() - 8 * 86_400_000, old);

  assert.throws(() => createSanctionAppeal("guild-b", "member-a", recent, "This is a valid appeal."), /appartient pas/);
  assert.throws(() => createSanctionAppeal("guild-a", "someone-else", recent, "This is a valid appeal."), /appartient pas/);
  assert.throws(() => createSanctionAppeal("guild-a", "member-a", otherGuild, "This is a valid appeal."), /appartient pas/);
  assert.throws(() => createSanctionAppeal("guild-a", "member-a", old, "This is a valid appeal."), /7 jours/);
  assert.throws(() => createSanctionAppeal("guild-a", "member-a", unmute, "This is a valid appeal."), /appartient pas/);
  assert.throws(() => createSanctionAppeal("guild-a", "member-a", recent, "short"), /10 caractères/);
  assert.throws(() => createSanctionAppeal("guild-a", "member-a", recent, "          "), /10 caractères/);
});

test("appeals are unique per case and reviewers can resolve them only once in the source guild", () => {
  const caseId = recordModerationCase({ guildId: "guild-a", userId: "member-a", moderatorId: "staff", action: "mute", reason: "spam" });
  const appealId = createSanctionAppeal("guild-a", "member-a", caseId, "I believe this timeout was applied in error.");
  assert.deepEqual(listPendingModerationAppeals("guild-a", "member-a").map((item) => item.id), [appealId]);
  assert.deepEqual(listPendingModerationAppeals("guild-b", "member-a"), []);
  assert.throws(() => createSanctionAppeal("guild-a", "member-a", caseId, "A second valid appeal attempt."));
  assert.throws(() => reviewModerationAppeal("guild-b", "reviewer", appealId, "accepted"), /introuvable/);

  const reviewed = reviewModerationAppeal("guild-a", "reviewer", appealId, "accepted");
  assert.equal(reviewed.status, "accepted");
  assert.equal(reviewed.reviewed_by, "reviewer");
  assert.equal(listPendingModerationAppeals("guild-a", "member-a").length, 0);
  assert.throws(() => reviewModerationAppeal("guild-a", "reviewer-2", appealId, "rejected"), /déjà traité/);
  assert.throws(() => reviewModerationAppeal("guild-a", "reviewer", appealId, "dismissed"), /invalide/);
});

test("appeal review role names remain isolated by source server", () => {
  assert.equal(canReviewModerationAppeal("pnd", ["Logs Modération"]), true);
  assert.equal(canReviewModerationAppeal("pnd", ["MZ Logs Modération"]), false);
  assert.equal(canReviewModerationAppeal("mz", ["Logs Owner"]), false);
  assert.equal(canReviewModerationAppeal("mz", ["MZ Logs Admin"]), true);
  assert.equal(canReviewModerationAppeal("unknown", ["Logs Admin"]), false);
});
