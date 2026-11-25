import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITICAL_PERMISSIONS,
  REQUIRED_PERMISSIONS,
  criticalPermissionsForProfile,
  requiredPermissionsForProfile,
} from "./permissions-catalog.js";

const EXPECTED_PROFILES = [
  "fwu",
  "guard",
  "fdpdlavoc",
  "suckme",
  "fisc",
  "investplus",
];

test("the permission catalogue covers every FWU application, including optional Invest+", () => {
  assert.deepEqual(Object.keys(REQUIRED_PERMISSIONS).sort(), [...EXPECTED_PROFILES].sort());
  for (const profile of EXPECTED_PROFILES) {
    const required = requiredPermissionsForProfile(profile);
    assert.ok(required.length > 0, `${profile} doit déclarer ses permissions`);
    assert.equal(new Set(required).size, required.length, `${profile} ne doit pas répéter une permission`);
    assert.ok(criticalPermissionsForProfile(profile).every((name) => required.includes(name)), `${profile} : permission critique non déclarée comme requise`);
  }
});

test("all six applications share the same broad operational permission catalogue", () => {
  assert.ok(requiredPermissionsForProfile("fwu").includes("ModerateMembers"));
  assert.ok(requiredPermissionsForProfile("guard").includes("BanMembers"));
  assert.ok(requiredPermissionsForProfile("fdpdlavoc").includes("Connect"));
  assert.ok(requiredPermissionsForProfile("fdpdlavoc").includes("Speak"));
  assert.ok(requiredPermissionsForProfile("suckme").includes("ManageNicknames"));
  assert.ok(requiredPermissionsForProfile("fisc").includes("SendMessages"));
  assert.ok(requiredPermissionsForProfile("investplus").includes("ManageChannels"));
  assert.ok(requiredPermissionsForProfile("investplus").includes("ManageRoles"));
  const catalogues = EXPECTED_PROFILES.map((profile) => requiredPermissionsForProfile(profile));
  assert.ok(catalogues.every((permissions) => JSON.stringify(permissions) === JSON.stringify(catalogues[0])));
  assert.ok(requiredPermissionsForProfile("fisc").includes("MoveMembers"));
  assert.ok(requiredPermissionsForProfile("fwu").includes("ManageWebhooks"));
  assert.ok(EXPECTED_PROFILES.every((profile) => !requiredPermissionsForProfile(profile).includes("Administrator")));
});

test("a permission critical to one bot is not automatically critical to another", () => {
  assert.ok(CRITICAL_PERMISSIONS.guard.includes("BanMembers"));
  assert.equal(CRITICAL_PERMISSIONS.fisc.includes("BanMembers"), false);
  assert.ok(CRITICAL_PERMISSIONS.fdpdlavoc.includes("Connect"));
  assert.equal(CRITICAL_PERMISSIONS.suckme.includes("Connect"), false);
});
