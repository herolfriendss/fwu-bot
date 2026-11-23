import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-staff-hierarchy-"));
process.env.HER_DB_PATH = join(directory, "test.sqlite");
const store = await import("./staff-hierarchy.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const guildA = "1562643485981544559";
const guildB = "1562643485981544560";
const owner = "100000000000000001";
const mod = "100000000000000002";
const manager = "100000000000000003";
const lead = "100000000000000004";

test("supervisor mappings persist, remain guild-isolated, and can be updated or removed", () => {
  const first = store.setStaffSupervisor({
    guildId: guildA, staffUserId: mod, supervisorUserId: manager,
    updatedBy: owner, guildOwnerId: owner, now: 100,
  });
  assert.deepEqual(first, {
    guildId: guildA, staffUserId: mod, supervisorUserId: manager,
    updatedBy: owner, updatedAt: 100,
  });
  assert.equal(store.getStaffSupervisorId(guildA, mod), manager);
  assert.equal(store.getStaffSupervisorId(guildB, mod), null);

  store.setStaffSupervisor({
    guildId: guildA, staffUserId: mod, supervisorUserId: lead,
    updatedBy: owner, guildOwnerId: owner, now: 200,
  });
  assert.equal(store.getStaffSupervisorId(guildA, mod), lead);
  assert.equal(store.listStaffSupervisors(guildA).length, 1);
  assert.equal(store.removeStaffSupervisor({ guildId: guildA, staffUserId: mod }), true);
  assert.equal(store.removeStaffSupervisor({ guildId: guildA, staffUserId: mod }), false);
  assert.equal(store.getStaffSupervisorId(guildA, mod), null);
});

test("store refuses invalid assignments and circular supervisor chains", () => {
  store.setStaffSupervisor({
    guildId: guildA, staffUserId: mod, supervisorUserId: manager,
    updatedBy: owner, guildOwnerId: owner, now: 300,
  });
  store.setStaffSupervisor({
    guildId: guildA, staffUserId: manager, supervisorUserId: lead,
    updatedBy: owner, guildOwnerId: owner, now: 301,
  });
  assert.throws(() => store.setStaffSupervisor({
    guildId: guildA, staffUserId: lead, supervisorUserId: mod,
    updatedBy: owner, guildOwnerId: owner, now: 302,
  }), /boucle/);
  assert.throws(() => store.setStaffSupervisor({
    guildId: guildA, staffUserId: owner, supervisorUserId: lead,
    updatedBy: owner, guildOwnerId: owner, now: 303,
  }), /sommet/);
  assert.throws(() => store.setStaffSupervisor({
    guildId: guildA, staffUserId: "invalid", supervisorUserId: lead,
    updatedBy: owner, guildOwnerId: owner, now: 304,
  }), /Identifiants Discord invalides/);
});
