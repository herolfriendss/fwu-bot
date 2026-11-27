import test from "node:test";
import assert from "node:assert/strict";
import { hours, presetKey, voiceLeaderboard } from "./voice-plus.js";
import { db } from "../database.js";

test("voice leaderboard and preset names", () => {
  const now = Date.now();
  db.prepare("INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,left_at,duration_ms) VALUES ('vg','a','c',?,?,?)").run(now - 1000, now, 7_200_000);
  db.prepare("INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,left_at,duration_ms) VALUES ('vg','b','c',?,?,?)").run(now - 1000, now, 3_600_000);
  db.prepare("INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,left_at,duration_ms) VALUES ('vg','c','c',?,?,?)").run(now - 40 * 86_400_000, now, 99_000_000);
  assert.deepEqual(voiceLeaderboard("vg", "semaine", now).map((r) => r.user_id), ["a", "b"]);
  assert.equal(voiceLeaderboard("vg", "total", now)[0].user_id, "c");
  assert.equal(hours(5_400_000), "1 h 30");
  assert.equal(presetKey("  Soirée Jeux! <@1> "), "soirée jeux 1");
});
