import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-temp-voice-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const { reconcileTempVoices } = await import("./voice-v2.js");
const { db } = await import("./database.js");

const g = "850000000000000001";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

test("restart reconciliation: deleted rows dropped, emptied channels removed, transient errors kept, occupied kept", async () => {
  const insert = (id) =>
    db
      .prepare(
        "INSERT INTO temp_voice(channel_id,guild_id,owner_id,created_at) VALUES(?,?,?,0)",
      )
      .run(id, g, "850000000000000002");
  ["c-deleted", "c-empty", "c-busy", "c-flaky"].forEach(insert);
  const deleted = [];
  const channels = {
    "c-empty": {
      members: { size: 0 },
      delete: async () => {
        deleted.push("c-empty");
      },
    },
    "c-busy": {
      members: { size: 2 },
      delete: async () => {
        deleted.push("c-busy");
      },
    },
  };
  const guild = {
    channels: {
      fetch: async (id) => {
        if (channels[id]) return channels[id];
        const error = new Error(
          id === "c-flaky" ? "Service Unavailable" : "Unknown Channel",
        );
        error.code = id === "c-flaky" ? 500 : 10003;
        throw error;
      },
    },
  };
  const result = await reconcileTempVoices({
    guilds: { cache: new Map([[g, guild]]) },
  });
  assert.deepEqual(deleted, ["c-empty"]);
  assert.equal(result.removed, 1);
  assert.equal(result.emptiedDeleted, 1);
  const remaining = db
    .prepare("SELECT channel_id FROM temp_voice ORDER BY channel_id")
    .all()
    .map((r) => r.channel_id);
  assert.deepEqual(remaining, ["c-busy", "c-flaky"]);
});
