import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-menotte-runtime-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const { expireVoiceMenottes } = await import("./voice-commands.js");
const { db } = await import("./database.js");

test("expiration deletes only due guild/member records and writes a scoped audit row", async (context) => {
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });
  const now = Date.now();
  db.prepare("INSERT INTO voice_menottes(guild_id,member_id,channel_id,owner_id,created_at,expires_at) VALUES(?,?,?,?,?,?)")
    .run("guild-a", "member-expired", "channel-a", "owner-a", now - 60_000, now - 1);
  db.prepare("INSERT INTO voice_menottes(guild_id,member_id,channel_id,owner_id,created_at,expires_at) VALUES(?,?,?,?,?,?)")
    .run("guild-b", "member-active", "channel-b", "owner-b", now, now + 60_000);

  const client = {
    user: { id: "bot-test" },
    guilds: { cache: { get: () => null } },
  };
  assert.equal(await expireVoiceMenottes(client), 1);
  assert.equal(db.prepare("SELECT 1 FROM voice_menottes WHERE guild_id=? AND member_id=?").get("guild-a", "member-expired"), undefined);
  assert.ok(db.prepare("SELECT 1 FROM voice_menottes WHERE guild_id=? AND member_id=?").get("guild-b", "member-active"));
  assert.deepEqual(
    { ...db.prepare("SELECT guild_id,actor_id,action,target_id FROM sysplus_audit WHERE action=?").get("voice.menotte.expire") },
    { guild_id: "guild-a", actor_id: "bot-test", action: "voice.menotte.expire", target_id: "member-expired" },
  );
});
