import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs every catalogue command through the real handler chain with simulated
// Discord objects; fails on any programming error (e.g. the former /warn
// "db.transaction is not a function" or /lockname liste crash).
test("no slash command of the catalogue crashes with a programming error", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      fileURLToPath(new URL("./scripts/smoke-commands.mjs", import.meta.url)),
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  const summary = JSON.parse(
    output.slice(output.indexOf("{"), output.indexOf("}") + 1),
  );
  assert.ok(summary.runs > 500, `only ${summary.runs} runs`);
  assert.equal(summary.findings, 0, output);
  assert.deepEqual(summary.unhandled, []);
});
