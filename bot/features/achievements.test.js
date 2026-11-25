import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-ach-")), "db.sqlite");
const { db } = await import("../database.js");
await import("./community.js");
const { ACHIEVEMENTS, checkAchievements, achievementsText } = await import("./achievements.js");

test("achievements unlock once from tracked activity", () => {
  db.prepare("INSERT OR REPLACE INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes) VALUES('g','u',0,5,600,70)").run();
  const first = checkAchievements("g", "u", 1000).map((a) => a.key);
  assert.deepEqual(first.sort(), ["bavard", "micro", "niveau_5", "premier_message"].sort());
  assert.deepEqual(checkAchievements("g", "u", 2000), []);
  db.prepare("INSERT INTO community_birthdays(guild_id,user_id,day,month) VALUES('g','u',1,1)").run();
  assert.deepEqual(checkAchievements("g", "u").map((a) => a.key), ["anniversaire"]);
  const text = achievementsText("g", "u", "x");
  assert.match(text.title, new RegExp(`5/${ACHIEVEMENTS.length}`));
  assert.match(text.description, /🔒 Légende/);
});
