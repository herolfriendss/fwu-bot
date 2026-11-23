import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-sysplus-audit-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("../../database.js");
const { listSysPlusAudit, recordSysPlusAudit } = await import("./audit.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("privileged audit keeps bounded JSON valid and isolates guild history", () => {
  recordSysPlusAudit("guild-a", "owner-a", "permission.update", "scope-a", { enabled: true });
  const huge = { note: "x".repeat(5_000) };
  recordSysPlusAudit("guild-a", "owner-a", "large.details", null, huge);
  const circular = {};
  circular.self = circular;
  recordSysPlusAudit("guild-a", "owner-a", "circular.details", null, circular);
  db.prepare("INSERT INTO sysplus_audit(guild_id,actor_id,action,details,created_at) VALUES('guild-a','owner-a','legacy.invalid','{',?)").run(Date.now());
  recordSysPlusAudit("guild-b", "owner-b", "separate", null, { guild: "b" });

  const rows = listSysPlusAudit("guild-a", 10);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find((row) => row.action === "permission.update").details, { enabled: true });
  assert.deepEqual(rows.find((row) => row.action === "large.details").details, { truncated: true, reason: "size_limit" });
  assert.deepEqual(rows.find((row) => row.action === "circular.details").details, { truncated: true, reason: "unserializable" });
  assert.equal(rows.find((row) => row.action === "legacy.invalid").details, null);
  assert.deepEqual(listSysPlusAudit("guild-b", 10).map((row) => row.action), ["separate"]);
  assert.throws(() => recordSysPlusAudit("", "owner-a", "invalid"), /Contexte/);
});
