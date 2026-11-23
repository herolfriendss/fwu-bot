import test from "node:test";
import assert from "node:assert/strict";
import { validateOwnerConfig, assertOwnerConfig } from "./owner-config.js";

const OWNER = "100000000000000001";
const BTK = "100000000000000002";
const MZ = "100000000000000003";
const silent = { warn() {}, error() {} };

test("a single owner with two distinct cofounders is valid", () => {
  const result = validateOwnerConfig({
    PND_OWNER_DISCORD_ID: OWNER,
    PND_COFOUNDER_DISCORD_IDS: `${BTK},${MZ}`,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("a missing owner is only a warning: owner commands stay denied", () => {
  const result = validateOwnerConfig({});
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
});

test("a list of owners is rejected instead of silently dropping the owner", () => {
  for (const value of [`${OWNER},${BTK}`, `${OWNER} ${BTK}`, "not-an-id"]) {
    const result = validateOwnerConfig({ PND_OWNER_DISCORD_ID: value });
    assert.equal(result.ok, false, value);
  }
});

test("the legacy plural owner variable is rejected", () => {
  assert.equal(
    validateOwnerConfig({
      PND_OWNER_DISCORD_ID: OWNER,
      PND_OWNER_DISCORD_IDS: `${OWNER},${BTK}`,
    }).ok,
    false,
  );
});

test("a cofounder can never be the owner, and cofounder lists must be clean", () => {
  assert.equal(
    validateOwnerConfig({
      PND_OWNER_DISCORD_ID: OWNER,
      PND_COFOUNDER_DISCORD_IDS: `${OWNER},${MZ}`,
    }).ok,
    false,
  );
  assert.equal(
    validateOwnerConfig({
      PND_OWNER_DISCORD_ID: OWNER,
      PND_COFOUNDER_DISCORD_IDS: `${BTK},${BTK}`,
    }).ok,
    false,
  );
  assert.equal(
    validateOwnerConfig({
      PND_OWNER_DISCORD_ID: OWNER,
      PND_COFOUNDER_DISCORD_IDS: `${BTK},abc`,
    }).ok,
    false,
  );
});

test("error messages never echo identifiers", () => {
  const result = validateOwnerConfig({
    PND_OWNER_DISCORD_ID: `${OWNER},${BTK}`,
    PND_COFOUNDER_DISCORD_IDS: OWNER,
  });
  const text = JSON.stringify(result);
  assert.equal(text.includes(OWNER), false);
  assert.equal(text.includes(BTK), false);
});

test("assertOwnerConfig throws on contradictory configuration and not on a valid one", () => {
  assert.throws(
    () =>
      assertOwnerConfig({ PND_OWNER_DISCORD_ID: `${OWNER},${BTK}` }, silent),
    /démarrage refusé/,
  );
  assert.doesNotThrow(() =>
    assertOwnerConfig({ PND_OWNER_DISCORD_ID: OWNER }, silent),
  );
});
