import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./database.js";
import { ACTIVITY_DAYS, ACTIVITY_TOP, activityDays, buildActivitySnapshot } from "./activity-snapshot.js";
import "./features/community.js";
import { incrementDailyMetric } from "./organization.js";

const G = "100000000000000901";
const OTHER = "100000000000000902";
const NOW = Date.UTC(2026, 10, 25, 12, 0);
const user = (i) => `2000000000000${String(i).padStart(5, "0")}`;

test("30 distinct UTC days, oldest first, like analytics_daily.day_key", () => {
  const days = activityDays(NOW);
  assert.equal(days.length, ACTIVITY_DAYS);
  assert.equal(new Set(days).size, ACTIVITY_DAYS);
  assert.equal(days[0], "2026-10-27");
  assert.equal(days.at(-1), "2026-11-25");
});

test("an empty guild gives a valid, empty snapshot", () => {
  const snap = buildActivitySnapshot("100000000000000999", null, NOW);
  assert.deepEqual(snap, {
    guildId: "100000000000000999", guildName: null, levelsEnabled: true, rankedMembers: 0,
    topXp: [], daily: [], animation: null, capturedAt: new Date(NOW).toISOString(),
  });
});

test("the snapshot is bounded, isolated per guild and holds no message content", () => {
  const insert = db.prepare("INSERT OR REPLACE INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes) VALUES(?,?,?,?,?,?)");
  for (let i = 0; i < 40; i++) insert.run(G, user(i), 1000 - i, 3, 50, 7);
  insert.run(G, user(99), 0, 0, 0, 0);
  insert.run(OTHER, user(500), 999_999, 50, 1, 1);
  incrementDailyMetric(G, "messages", 12, NOW);
  incrementDailyMetric(G, "messages", 3, NOW);
  incrementDailyMetric(G, "joins", 2, NOW - 86_400_000);
  incrementDailyMetric(G, "messages", 5, NOW - 40 * 86_400_000);
  incrementDailyMetric(OTHER, "messages", 77, NOW);
  const guild = { name: "  PND  ", members: { cache: new Map([[user(0), { displayName: "Alice" }]]) } };

  const snap = buildActivitySnapshot(G, guild, NOW);
  assert.equal(snap.guildName, "PND");
  assert.equal(snap.rankedMembers, 40, "un membre à 0 XP n'est pas classé");
  assert.equal(snap.topXp.length, ACTIVITY_TOP);
  assert.deepEqual(snap.topXp[0], { userId: user(0), displayName: "Alice", xp: 1000, level: 3, messages: 50, voiceMinutes: 7 });
  assert.equal(snap.topXp[1].displayName, null, "nom inconnu : null, jamais le pseudo du compte");
  assert.ok(!snap.topXp.some((m) => m.userId === user(500)), "aucune donnée d'un autre serveur");
  assert.deepEqual(snap.daily, [
    { day: "2026-11-24", messages: 0, joins: 2, leaves: 0 },
    { day: "2026-11-25", messages: 15, joins: 0, leaves: 0 },
  ], "jours sans activité absents, jours trop anciens exclus, aucun doublon");
  assert.equal(new Set(snap.daily.map((d) => d.day)).size, snap.daily.length);
  assert.ok(JSON.stringify({ snapshots: [snap] }).length < 10_000);
  assert.deepEqual(Object.keys(snap).sort(), ["animation", "capturedAt", "daily", "guildId", "guildName", "levelsEnabled", "rankedMembers", "topXp"]);
});

test("disabled levels and animation figures are reported when present", () => {
  db.prepare("INSERT OR REPLACE INTO community_level_config(guild_id,enabled,channel_id,rewards_json) VALUES(?,0,NULL,'{}')").run(OTHER);
  assert.equal(buildActivitySnapshot(OTHER, null, NOW).levelsEnabled, false);
  db.exec("CREATE TABLE IF NOT EXISTS animation_counting (guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER, current INTEGER, last_user_id TEXT, last_message_id TEXT, record INTEGER, record_at INTEGER, fails INTEGER)");
  db.prepare("INSERT OR REPLACE INTO animation_counting(guild_id,record,current) VALUES(?,?,?)").run(G, 312, 45);
  assert.deepEqual(buildActivitySnapshot(G, null, NOW).animation, { countingRecord: 312, countingCurrent: 45, starboardPosts: 0, qotdPosted: 0 });
});
