import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-voice-reconcile-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db, transaction } = await import("./database.js");
const { reconcileVoiceSessions } = await import("./voice-session-reconciliation.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function seedOpen(guildId, userId, channelId, joinedAt, precision = "exact") {
  db.prepare(`INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,start_precision)
    VALUES(?,?,?,?,?)`).run(guildId, userId, channelId, joinedAt, precision);
}

test("startup reconciliation closes stale sessions and creates approximate active snapshots", () => {
  const now = 2_000_000_000_000;
  seedOpen("123456", "111111", "222222", now - 60_000); // remains in same channel
  seedOpen("123456", "333333", "444444", now - 120_000); // left while bot offline
  seedOpen("123456", "555555", "666666", now - 90_000); // moved while bot offline
  seedOpen("999999", "777777", "888888", now - 60_000); // other guild untouched

  const events = [];
  const result = reconcileVoiceSessions({
    db, transaction, guildId: "123456", now,
    activeMembers: new Map([
      ["111111", "222222"],
      ["555555", "777777"],
      ["999991", "999992"],
    ]),
    recordEvent: (event) => events.push(event),
  });

  assert.deepEqual(result, { created: 2, closed: 2, moved: 1, unchanged: 1 });
  const open = db.prepare("SELECT user_id,channel_id,start_precision FROM voice_sessions WHERE guild_id='123456' AND left_at IS NULL ORDER BY user_id").all().map((row) => ({ ...row }));
  assert.deepEqual(open, [
    { user_id: "111111", channel_id: "222222", start_precision: "exact" },
    { user_id: "555555", channel_id: "777777", start_precision: "approximate" },
    { user_id: "999991", channel_id: "999992", start_precision: "approximate" },
  ]);
  const closed = db.prepare("SELECT user_id,left_at,end_precision,end_reason FROM voice_sessions WHERE guild_id='123456' AND left_at IS NOT NULL ORDER BY user_id").all().map((row) => ({ ...row }));
  assert.deepEqual(closed, [
    { user_id: "333333", left_at: now, end_precision: "approximate", end_reason: "reconciled_offline_leave" },
    { user_id: "555555", left_at: now, end_precision: "approximate", end_reason: "reconciled_channel_change" },
  ]);
  assert.equal(db.prepare("SELECT left_at FROM voice_sessions WHERE guild_id='999999' AND user_id='777777'").get().left_at, null);
  assert.equal(events.length, 4);
  assert.ok(events.every((event) => event.source === "startup_snapshot"));
});

test("repeated snapshots are idempotent and preserve existing exact sessions", () => {
  const now = 2_000_000_100_000;
  seedOpen("234567", "111111", "222222", now - 50_000, "exact");
  const active = new Map([["111111", "222222"], ["345678", "456789"]]);
  let eventCount = 0;
  const recordEvent = () => { eventCount++; };
  const first = reconcileVoiceSessions({ db, transaction, guildId: "234567", activeMembers: active, now, recordEvent });
  const second = reconcileVoiceSessions({ db, transaction, guildId: "234567", activeMembers: active, now: now + 1, recordEvent });
  assert.deepEqual(first, { created: 1, closed: 0, moved: 0, unchanged: 1 });
  assert.deepEqual(second, { created: 0, closed: 0, moved: 0, unchanged: 2 });
  assert.equal(eventCount, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM voice_sessions WHERE guild_id='234567' AND user_id='345678'").get().count, 1);
  assert.equal(db.prepare("SELECT start_precision FROM voice_sessions WHERE guild_id='234567' AND user_id='111111' AND left_at IS NULL").get().start_precision, "exact");
});
