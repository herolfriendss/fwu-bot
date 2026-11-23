import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-admin-scopes-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("../../database.js");
const { getAdminPlusScope, setAdminPlusScope } = await import("./admin-plus-scopes.js");
const { getAdminPlusRoleId, setAdminPlusRoleId } = await import("./role-config.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("ADMIN+ role configuration and scopes persist independently per guild", () => {
  assert.equal(getAdminPlusScope("guild-a", "roles"), true);
  assert.equal(getAdminPlusScope("guild-a", "voice"), true);
  assert.equal(getAdminPlusScope("guild-a", "tickets"), false);
  setAdminPlusRoleId("guild-a", "role-a", "owner-a");
  setAdminPlusScope("guild-a", "tickets", true, "owner-a");
  setAdminPlusScope("guild-a", "voice", false, "owner-a");

  assert.equal(getAdminPlusRoleId("guild-a"), "role-a");
  assert.equal(getAdminPlusRoleId("guild-b"), null);
  assert.equal(getAdminPlusScope("guild-a", "tickets"), true);
  assert.equal(getAdminPlusScope("guild-b", "tickets"), false);
  assert.equal(getAdminPlusScope("guild-a", "voice"), false);
  assert.equal(getAdminPlusScope("guild-b", "voice"), true);
  assert.throws(() => setAdminPlusScope("guild-a", "unknown", true, "owner-a"), /invalide/);
  assert.throws(() => setAdminPlusRoleId("guild-a", "role-a", ""), /incomplète/);
});
