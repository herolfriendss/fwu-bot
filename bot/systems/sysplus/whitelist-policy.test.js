import test from "node:test";
import assert from "node:assert/strict";
import {
  canManageWhitelist,
  isValidWhitelistRole,
  isWhitelistMember,
  WHITELIST_ROLE_NAME,
} from "./whitelist-policy.js";
import { isAdminPlus, isSysPlus } from "./permissions.js";

test("only the Discord server owner can administer the whitelist", () => {
  assert.equal(canManageWhitelist("owner", "owner", "guild-a"), true);
  assert.equal(canManageWhitelist("sysplus", "owner", "guild-a"), false);
  assert.equal(canManageWhitelist("admin", "owner", "guild-a"), false);
});

test("whitelist membership checks only the configured role", () => {
  const member = { guild: { id: "guild" }, roles: { cache: new Map([["wl-role", true]]) } };
  assert.equal(isWhitelistMember(member, "wl-role"), true);
  assert.equal(isWhitelistMember(member, "sysplus-role"), false);
  assert.equal(isWhitelistMember(member, null), false);
  assert.equal(isSysPlus(member, "sysplus-role"), false);
  assert.equal(isAdminPlus(member, "sysplus-role", "adminplus-role"), false);
});

test("configured whitelist role has the exact name and is below the bot", () => {
  assert.equal(WHITELIST_ROLE_NAME, "WHITELIST");
  const role = { id: "role", name: WHITELIST_ROLE_NAME, managed: false, position: 2 };
  assert.equal(isValidWhitelistRole(role, "guild", 3), true);
  assert.equal(isValidWhitelistRole({ ...role, name: "Staff" }, "guild", 3), false);
  assert.equal(isValidWhitelistRole({ ...role, position: 3 }, "guild", 3), false);
  assert.equal(isValidWhitelistRole({ ...role, managed: true }, "guild", 3), false);
});
