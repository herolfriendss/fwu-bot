import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-stability-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const S = await import("./stability.js");
const { db } = await import("./database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });
const env = { PND_OWNER_DISCORD_ID: "900000000000000009" };
const admin = { id: "1", guild: { ownerId: "2" }, permissions: { has: () => true } };

test("scenario: the staff cuts a failing command without restarting, the OWNER still passes, then it comes back", () => {
  assert.match(S.runToolCommand({ member: admin, sub: "commande-off", command: "/casino", reason: "bug", profile: "fisc" }, { env }), /coupée/);
  assert.match(S.stabilityRefusal({ profile: "fisc", command: "casino", userId: "5", env }), /temporairement coupée.*bug/);
  assert.equal(S.stabilityRefusal({ profile: "fisc", command: "casino", userId: env.PND_OWNER_DISCORD_ID, env }), null);
  assert.equal(S.stabilityRefusal({ profile: "fisc", command: "stabilite", userId: "5", env }), null, "the switch itself can never be cut");
  assert.throws(() => S.disableCommand("stabilite"), /ne peut pas/);
  S.runToolCommand({ member: admin, sub: "commande-on", command: "casino", profile: "fisc" }, { env });
  assert.equal(S.stabilityRefusal({ profile: "fisc", command: "casino", userId: "5", env }), null);
});

test("scenario: maintenance mode per bot shows a clear message to members", () => {
  S.runToolCommand({ member: admin, sub: "maintenance-on", reason: "mise à jour", profile: "guard" }, { env });
  assert.match(S.stabilityRefusal({ profile: "guard", command: "ban", userId: "5", env }), /maintenance : mise à jour/);
  assert.equal(S.stabilityRefusal({ profile: "fisc", command: "ban", userId: "5", env }), null, "other bots untouched");
  S.runToolCommand({ member: admin, sub: "maintenance-off", profile: "guard" }, { env });
  assert.equal(S.maintenanceState("guard"), null);
  const nobody = { id: "7", guild: { ownerId: "2" }, permissions: { has: () => false } };
  assert.match(S.runToolCommand({ member: nobody, sub: "maintenance-on", profile: "guard" }, { env }), /Réservé/);
});

test("scenario: a repeated error raises one alert per window", () => {
  const alerts = [];
  const watch = S.createErrorWatch({ threshold: 3, windowMs: 1000, onAlert: (code, n) => alerts.push([code, n]) });
  watch("music_error", 0); watch("music_error", 10);
  assert.equal(alerts.length, 0);
  assert.equal(watch("music_error", 20), true);
  watch("music_error", 30);
  assert.equal(alerts.length, 1, "no flood");
  watch("music_error", 2000); watch("music_error", 2010); watch("music_error", 2020);
  assert.equal(alerts.length, 2);
});

test("global maintenance blocks every bot and can only be ended by the OWNER", () => {
  const owner = { id: env.PND_OWNER_DISCORD_ID, guild: { ownerId: "2" }, permissions: { has: () => false } };
  assert.match(S.runToolCommand({ member: owner, sub: "maintenance-global-on", reason: "mise à jour globale", profile: "fwu" }, { env }), /Maintenance globale activée/);
  for (const profile of ["fwu", "guard", "fdpdlavoc", "suckme", "fisc", "investplus"]) {
    assert.match(S.stabilityRefusal({ profile, command: "ban", userId: "5", env }), /maintenance : mise à jour globale/);
  }
  assert.equal(S.stabilityRefusal({ profile: "guard", command: "ban", userId: owner.id, env }), null, "OWNER keeps emergency access");
  assert.match(S.runToolCommand({ member: admin, sub: "maintenance-global-off", profile: "fwu" }, { env }), /Seul l'OWNER/);
  assert.match(S.runToolCommand({ member: owner, sub: "maintenance-global-off", profile: "fwu" }, { env }), /Maintenance globale terminée/);
  for (const profile of ["fwu", "guard", "fdpdlavoc", "suckme", "fisc", "investplus"]) {
    assert.equal(S.stabilityRefusal({ profile, command: "ban", userId: "5", env }), null);
  }
  assert.equal(S.globalMaintenanceState(), null);
});
