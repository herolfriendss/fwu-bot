import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-waouf-runtime-"));
process.env.HER_DB_PATH = join(directory, "waouf.sqlite");
const { expireWaoufActions } = await import("./commands.js");
const { db } = await import("../../database.js");

test("expiration removes only due activations and keeps guild-scoped audit records", async (context) => {
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });
  const now = Date.now();
  db.prepare(
    "INSERT INTO waouf_active(guild_id,member_id,started_by,started_at,expires_at,deleted_count) VALUES(?,?,?,?,?,?)",
  ).run("guild-a", "member-expired", "operator-a", now - 60_000, now - 1, 4);
  db.prepare(
    "INSERT INTO waouf_active(guild_id,member_id,started_by,started_at,expires_at,deleted_count) VALUES(?,?,?,?,?,?)",
  ).run("guild-b", "member-active", "operator-b", now, now + 60_000, 1);

  const client = { user: { id: "bot-test" }, guilds: { cache: { get: () => null } } };
  assert.equal(await expireWaoufActions(client), 1);
  assert.equal(
    db
      .prepare("SELECT 1 FROM waouf_active WHERE guild_id=? AND member_id=?")
      .get("guild-a", "member-expired"),
    undefined,
  );
  assert.ok(
    db
      .prepare("SELECT 1 FROM waouf_active WHERE guild_id=? AND member_id=?")
      .get("guild-b", "member-active"),
  );
  assert.deepEqual(
    {
      ...db
        .prepare("SELECT guild_id,actor_id,action,target_id FROM sysplus_audit WHERE action=?")
        .get("waouf.expire"),
    },
    {
      guild_id: "guild-a",
      actor_id: "operator-a",
      action: "waouf.expire",
      target_id: "member-expired",
    },
  );
});
