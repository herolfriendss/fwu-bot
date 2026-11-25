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

test("permissions follow the six application responsibilities, not a shared global list", () => {
  assert.ok(requiredPermissionsForProfile("fwu").includes("ModerateMembers"));
  assert.ok(requiredPermissionsForProfile("guard").includes("BanMembers"));
  assert.ok(requiredPermissionsForProfile("fdpdlavoc").includes("Connect"));
  assert.ok(requiredPermissionsForProfile("fdpdlavoc").includes("Speak"));
  assert.ok(requiredPermissionsForProfile("suckme").includes("ManageNicknames"));
  assert.ok(requiredPermissionsForProfile("fisc").includes("SendMessages"));
  assert.ok(requiredPermissionsForProfile("investplus").includes("ManageChannels"));
  assert.ok(requiredPermissionsForProfile("investplus").includes("ManageRoles"));
  assert.equal(requiredPermissionsForProfile("fisc").includes("MoveMembers"), false);
  assert.equal(requiredPermissionsForProfile("fwu").includes("ManageWebhooks"), false);
});

test("a permission critical to one bot is not automatically critical to another", () => {
  assert.ok(CRITICAL_PERMISSIONS.guard.includes("BanMembers"));
  assert.equal(CRITICAL_PERMISSIONS.fisc.includes("BanMembers"), false);
  assert.ok(CRITICAL_PERMISSIONS.fdpdlavoc.includes("Connect"));
  assert.equal(CRITICAL_PERMISSIONS.suckme.includes("Connect"), false);
});
