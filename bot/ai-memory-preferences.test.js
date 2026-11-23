import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "her-ai-memory-"));
process.env.HER_DB_PATH = join(tempDir, "test.sqlite");
const { hasAiMemoryConsent, setAiMemoryConsent } = await import("./ai-memory-preferences.js");

test("AI memory consent defaults off and is isolated by member and server", () => {
  assert.equal(hasAiMemoryConsent("guild-a", "user-a"), false);
  setAiMemoryConsent("guild-a", "user-a", true);
  assert.equal(hasAiMemoryConsent("guild-a", "user-a"), true);
  assert.equal(hasAiMemoryConsent("guild-a", "user-b"), false);
  assert.equal(hasAiMemoryConsent("guild-b", "user-a"), false);
});

test("AI memory consent can be revoked and stays revoked", () => {
  setAiMemoryConsent("guild-a", "user-a", false);
  assert.equal(hasAiMemoryConsent("guild-a", "user-a"), false);
});

test("AI memory consent rejects incomplete identifiers", () => {
  assert.throws(() => setAiMemoryConsent("", "user", true), /obligatoires/);
  assert.equal(hasAiMemoryConsent("", "user"), false);
});

test.after(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* test process cleanup */ }
});
