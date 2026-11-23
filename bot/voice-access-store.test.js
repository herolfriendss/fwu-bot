import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-voice-access-store-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { expireVoiceAccessRequests } = await import("./voice-access-store.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

function addRequest(id, status, expiresAt, createdAt = 1_000) {
  db.prepare(`INSERT INTO voice_access_requests(request_id,guild_id,channel_id,requester_id,owner_user_id,status,request_channel_id,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(id, "123456", "222222", id === "req1" ? "777777" : id === "req2" ? "888888" : "999999", "654321", status, "333333", createdAt, expiresAt);
}

test("pending requests expire on time while in-flight processing gets a grace period", () => {
  addRequest("req1", "pending", 10_000);
  addRequest("req2", "processing", 10_000);
  addRequest("req3", "processing", 10_000);
  const changed = db.prepare("UPDATE voice_access_requests SET created_at=? WHERE request_id=?");
  changed.run(1_000, "req2");
  changed.run(1_000, "req3");
  assert.equal(expireVoiceAccessRequests(10_001, 5_000), 1);
  assert.equal(db.prepare("SELECT status FROM voice_access_requests WHERE request_id='req1'").get().status, "expired");
  assert.equal(db.prepare("SELECT status FROM voice_access_requests WHERE request_id='req2'").get().status, "processing");
  assert.equal(expireVoiceAccessRequests(15_001, 5_000), 2);
  assert.equal(db.prepare("SELECT status FROM voice_access_requests WHERE request_id='req2'").get().status, "expired");
});

test("only the private voice owner or explicitly authorized staff can remove a block", async () => {
  const { removeVoiceAccessBlock } = await import("./voice-access-store.js");
  db.prepare(`INSERT INTO voice_private_channels(guild_id,channel_id,owner_user_id,source,active,created_at,updated_at)
    VALUES('123456','222222','654321','pv',1,1,1)`).run();
  db.prepare(`INSERT INTO voice_access_blocks(guild_id,channel_id,user_id,blocked_by,reason,created_at)
    VALUES('123456','222222','777777','654321','test',1)`).run();
  assert.throws(() => removeVoiceAccessBlock({ guildId: "123456", channelId: "222222", userId: "777777", actorId: "888888" }), /propriétaire/);
  const result = removeVoiceAccessBlock({ guildId: "123456", channelId: "222222", userId: "777777", actorId: "654321" });
  assert.equal(result.removed, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM voice_access_blocks WHERE guild_id='123456'").get().count, 0);
});
