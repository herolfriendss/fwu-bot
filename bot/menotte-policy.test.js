import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isMenotteExpired, parseMenotteDuration } from "./menotte-policy.js";

test("parses optional bounded MENOTTE durations", () => {
  assert.equal(parseMenotteDuration(undefined), null);
  assert.equal(parseMenotteDuration("30m"), 30 * 60_000);
  assert.equal(parseMenotteDuration("2H"), 2 * 60 * 60_000);
  assert.equal(parseMenotteDuration("30d"), 30 * 24 * 60 * 60_000);
});

test("rejects malformed, zero and over-limit MENOTTE durations", () => {
  for (const value of ["1", "0m", "1.5h", "31d", "50000m", "m5"]) {
    assert.throws(() => parseMenotteDuration(value), Error, value);
  }
});

test("expires finite MENOTTE deadlines and preserves indefinite records", () => {
  assert.equal(isMenotteExpired(999, 1000), true);
  assert.equal(isMenotteExpired(1001, 1000), false);
  assert.equal(isMenotteExpired(null, 1000), false);
});

test("additive migration preserves legacy MENOTTE rows and leaves them indefinite", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "pnd-menotte-migration-"));
  const path = join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE voice_menottes (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, member_id)
  )`);
  legacy.prepare("INSERT INTO voice_menottes VALUES(?,?,?,?,?)").run("guild-test", "member-test", "channel-test", "owner-test", 123);
  legacy.close();

  process.env.HER_DB_PATH = path;
  const { db } = await import(`./database.js?menotte-migration-${Date.now()}`);
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  const columns = db.prepare("PRAGMA table_info(voice_menottes)").all().map((column) => column.name);
  assert.ok(columns.includes("expires_at"));
  assert.deepEqual(
    { ...db.prepare("SELECT guild_id,member_id,expires_at FROM voice_menottes").get() },
    { guild_id: "guild-test", member_id: "member-test", expires_at: null },
  );
});
