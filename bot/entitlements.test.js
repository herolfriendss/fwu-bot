import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-entitlements-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const OWNER = "123456";
const { db } = await import("./database.js");
const ent = await import("./entitlements.js");
const { listSysPlusAudit } = await import("./systems/sysplus/audit.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD = "100000000000000001";
const OTHER = "100000000000000002";
const OWNER_A = "123456";
const COFOUNDER = "789012";
const SYS_PLUS_ADMIN = "999999";
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17);

test("only the configured PND owner can grant a pack", () => {
  assert.throws(() => ent.grantEntitlement({ guildId: GUILD, packKey: "server.tools", actorId: SYS_PLUS_ADMIN, configuredOwners: OWNER, now: NOW }), /propriétaire PND/);
  assert.throws(() => ent.grantEntitlement({ guildId: GUILD, packKey: "server.tools", actorId: "555555", configuredOwners: OWNER, now: NOW }), /propriétaire PND/);
  const grant = ent.grantEntitlement({ guildId: GUILD, packKey: "server.tools", actorId: OWNER_A, configuredOwners: OWNER, now: NOW });
  assert.equal(grant.status, "active");
  assert.equal(grant.expiresAt, null);
});

test("a cofounder cannot grant owner-only packs, and no grant can be created without the configured owner", () => {
  assert.throws(() => ent.grantEntitlement({ guildId: OTHER, packKey: "cloud", actorId: COFOUNDER, configuredOwners: null, now: NOW }), /propriétaire PND/);
  assert.throws(() => ent.grantEntitlement({ guildId: OTHER, packKey: "cloud", actorId: COFOUNDER, durationDays: 30, configuredOwners: OWNER, now: NOW }), /propriétaire PND/);
});

test("unknown packs, invalid durations and duplicate active grants are refused", () => {
  const base = { guildId: "100000000000000003", actorId: OWNER_A, configuredOwners: OWNER, now: NOW };
  assert.throws(() => ent.grantEntitlement({ ...base, packKey: "mz.custom" }), /Pack inconnu/);
  assert.throws(() => ent.grantEntitlement({ ...base, packKey: "cloud", durationDays: 0 }), /entre 1 et 730/);
  assert.throws(() => ent.grantEntitlement({ ...base, packKey: "cloud", durationDays: 731 }), /entre 1 et 730/);
  ent.grantEntitlement({ ...base, packKey: "cloud", durationDays: 10 });
  assert.throws(() => ent.grantEntitlement({ ...base, packKey: "cloud", durationDays: 10 }), /déjà actif/);
});

test("an expired grant is no longer active and is reported as expired, without being deleted", () => {
  const guild = "100000000000000004";
  const grant = ent.grantEntitlement({ guildId: guild, packKey: "lab", actorId: OWNER_A, durationDays: 5, configuredOwners: OWNER, now: NOW });
  const later = NOW + 6 * DAY;
  assert.deepEqual(ent.activeEntitlementKeys(guild, NOW + DAY), ["lab"]);
  assert.deepEqual(ent.activeEntitlementKeys(guild, later), []);
  const listed = ent.listEntitlements(guild, later);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, grant.id);
  assert.equal(listed[0].status, "expired");
});

test("revocation removes access immediately, is recorded, and cannot be repeated", () => {
  const guild = "100000000000000005";
  const grant = ent.grantEntitlement({ guildId: guild, packKey: "extensions", actorId: OWNER_A, configuredOwners: OWNER, now: NOW });
  assert.deepEqual(ent.activeEntitlementKeys(guild, NOW), ["extensions"]);
  assert.throws(() => ent.revokeEntitlement({ guildId: guild, entitlementId: grant.id, actorId: SYS_PLUS_ADMIN, configuredOwners: OWNER, now: NOW }), /propriétaire PND/);
  assert.throws(() => ent.revokeEntitlement({ guildId: guild, entitlementId: grant.id, actorId: COFOUNDER, configuredOwners: OWNER, now: NOW }), /propriétaire PND/);
  const revoked = ent.revokeEntitlement({ guildId: guild, entitlementId: grant.id, actorId: OWNER_A, configuredOwners: OWNER, now: NOW });
  assert.equal(revoked.status, "revoked");
  assert.deepEqual(ent.activeEntitlementKeys(guild, NOW), []);
  assert.throws(() => ent.revokeEntitlement({ guildId: guild, entitlementId: grant.id, actorId: OWNER_A, configuredOwners: OWNER, now: NOW }), /déjà révoquée/);
  const audit = listSysPlusAudit(guild, 10).map((row) => row.action);
  assert.ok(audit.includes("entitlement.grant"));
  assert.ok(audit.includes("entitlement.revoke"));
});

test("an owner cannot revoke another guild's grant by id", () => {
  const grant = ent.grantEntitlement({ guildId: "100000000000000006", packKey: "games.premium", actorId: OWNER_A, configuredOwners: OWNER, now: NOW });
  assert.throws(() => ent.revokeEntitlement({ guildId: "100000000000000007", entitlementId: grant.id, actorId: OWNER_A, configuredOwners: OWNER, now: NOW }), /introuvable sur ce serveur/);
  assert.deepEqual(ent.activeEntitlementKeys("100000000000000006", NOW), ["games.premium"]);
});

test("grants are isolated per guild and per pack", () => {
  assert.deepEqual(ent.activeEntitlementKeys(GUILD, NOW), ["server.tools"]);
  assert.deepEqual(ent.activeEntitlementKeys(OTHER, NOW), []);
  assert.deepEqual(ent.activeEntitlementKeys("100000000000000099", NOW), []);
});
