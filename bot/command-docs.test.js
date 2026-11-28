import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { renderCommandDocs } = await import("./scripts/generate-command-docs.mjs");

test("docs/COMMANDES.md is generated from the real catalogue and up to date", () => {
  const expected = renderCommandDocs();
  const current = readFileSync(new URL("../docs/COMMANDES.md", import.meta.url), "utf8");
  let mismatch = 0;
  while (mismatch < current.length && mismatch < expected.length && current[mismatch] === expected[mismatch]) mismatch += 1;
  assert.equal(current, expected, `Relance : node --experimental-strip-types bot/scripts/generate-command-docs.mjs (first mismatch ${mismatch}; current length ${current.length}; generated length ${expected.length}; current: ${JSON.stringify(current.slice(Math.max(0, mismatch - 100), mismatch + 220))}; generated: ${JSON.stringify(expected.slice(Math.max(0, mismatch - 100), mismatch + 220))})`);
  for (const name of ["ui", "authority", "staff", "rolepanel"]) assert.match(current, new RegExp(`### /${name}\\b`));
  assert.match(current, /`\/staff intervention ouvrir`/);
});
