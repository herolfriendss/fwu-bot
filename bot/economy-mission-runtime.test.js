import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-economy-missions-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { claimDailyMissions, dailyMissionRows, recordMissionProgress, pndBalance } =
  await import("./economy.js");
const { db } = await import("./database.js");

test("daily missions cap progress, reward once, and remain isolated by guild", (context) => {
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  const date = "2026-01-02";
  recordMissionProgress("guild-a", "member-a", "work", date);
  recordMissionProgress("guild-a", "member-a", "work", date);
  recordMissionProgress("guild-a", "member-a", "work", date);
  recordMissionProgress("guild-a", "member-a", "work", date);

  const completed = dailyMissionRows("guild-a", "member-a", date).find(
    (row) => row.mission_key === "work_three",
  );
  assert.equal(completed.progress, 3);
  assert.equal(completed.target, 3);
  assert.deepEqual(claimDailyMissions("guild-a", "member-a", date), { reward: 150, count: 1 });
  assert.deepEqual(claimDailyMissions("guild-a", "member-a", date), { reward: 0, count: 0 });
  assert.equal(pndBalance("guild-a", "member-a").balance, 150);
  assert.equal(pndBalance("guild-b", "member-a").balance, 0);
  assert.equal(
    dailyMissionRows("guild-b", "member-a", date).find((row) => row.mission_key === "work_three")
      .progress,
    0,
  );
  assert.equal(
    dailyMissionRows("guild-a", "member-a", date).find((row) => row.mission_key === "work_three")
      .claimed,
    1,
  );
});
