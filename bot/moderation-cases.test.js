import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-moderation-cases-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { listModerationCases, recordModerationCase } = await import("./moderation.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("moderation cases have unique IDs, bounded reasons, and strict guild/member isolation", () => {
  const warnId = recordModerationCase({
    guildId: "guild-a",
    userId: "member-a",
    moderatorId: "staff-a",
    action: "warn",
    reason: "  repeated\nspam  ",
    details: { expiresAt: 1000 },
  });
  const kickId = recordModerationCase({
    guildId: "guild-a",
    userId: "member-a",
    moderatorId: "staff-b",
    action: "kick",
    reason: "second case",
  });
  recordModerationCase({
    guildId: "guild-b",
    userId: "member-a",
    moderatorId: "staff-c",
    action: "ban",
    reason: "different guild",
  });
  const boundedId = recordModerationCase({
    guildId: "guild-a", userId: "member-a", moderatorId: "staff-a", action: "mute",
    reason: "bounded details", details: { payload: "x".repeat(5_000) },
  });
  const invalidDetailsId = Number(db.prepare(`INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,details_json,created_at)
    VALUES('guild-a','member-a','staff-a','warn','legacy bad JSON','{',?)`).run(Date.now()).lastInsertRowid);

  assert.notEqual(warnId, kickId);
  assert.deepEqual(
    listModerationCases("guild-a", "member-a", 1).map((row) => row.id),
    [invalidDetailsId],
  );
  assert.deepEqual(
    listModerationCases("guild-b", "member-a").map((row) => row.action),
    ["ban"],
  );
  assert.equal(listModerationCases("guild-a", "other-member").length, 0);
  const warning = listModerationCases("guild-a", "member-a", 25).find((row) => row.id === warnId);
  assert.equal(warning.reason, "repeated spam");
  assert.deepEqual(warning.details, { expiresAt: 1000 });
  assert.deepEqual(listModerationCases("guild-a", "member-a", 10).find((row) => row.id === boundedId).details,
    { truncated: true, reason: "size_limit" });
  assert.equal(listModerationCases("guild-a", "member-a", 10).find((row) => row.reason === "legacy bad JSON").details, null);
  assert.throws(
    () =>
      recordModerationCase({
        guildId: "guild-a",
        userId: "member-a",
        moderatorId: "staff",
        action: "ban-all",
        reason: "x",
      }),
    /invalide/,
  );
});
