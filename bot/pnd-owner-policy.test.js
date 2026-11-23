import test from "node:test";
import assert from "node:assert/strict";
import { isConfiguredPndOwner, parsePndOwnerId, parsePndOwnerIds, parsePndCofounderIds, getPndPrivilegedIds } from "./pnd-owner-policy.js";

const OWNER = "123456";
const COFOUNDERS = "654321,777777";

test("only the single configured PND owner receives owner-only privileges", () => {
  assert.equal(isConfiguredPndOwner(OWNER, OWNER, "guild-a"), true);
  assert.equal(isConfiguredPndOwner("654321", OWNER, "guild-a"), false);
});

test("unlisted or malformed actors are refused", () => {
  assert.equal(isConfiguredPndOwner("999999", OWNER, "guild-a"), false);
  assert.equal(isConfiguredPndOwner(undefined, OWNER, "guild-a"), false);
  assert.equal(isConfiguredPndOwner("owner", OWNER, "guild-a"), false);
});

test("owner configuration accepts exactly one snowflake and rejects legacy multi-owner lists", () => {
  assert.equal(parsePndOwnerId(OWNER), OWNER);
  for (const value of [undefined, "123456,654321", "123456,123456", "invalid", []]) assert.equal(parsePndOwnerId(value), null);
});

test("only one configured owner is exposed to legacy owner-list consumers", () => {
  assert.deepEqual(parsePndCofounderIds(COFOUNDERS, OWNER), []);
  assert.deepEqual(parsePndOwnerIds(OWNER), [OWNER]);
  assert.deepEqual(parsePndOwnerIds([OWNER]), [OWNER]);
  assert.deepEqual(parsePndOwnerIds([OWNER, COFOUNDERS.split(",")[0]]), []);
  assert.deepEqual(parsePndOwnerIds(COFOUNDERS), []);
  assert.deepEqual(getPndPrivilegedIds(OWNER, COFOUNDERS), [OWNER]);
  assert.deepEqual(getPndPrivilegedIds(OWNER, null), [OWNER]);
});
