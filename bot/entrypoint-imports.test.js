import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression: index.js imported a function that pnd-intelligence.js did not
// export, so the bot crashed before connecting (SyntaxError at link time).
// Unit tests import modules one by one and never saw it.
test("every named import of the bot entry point exists", async () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const missing = [];
  for (const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+"(\.{1,2}\/[^"]+)";/gm)) {
    const names = match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const module = await import(new URL(match[2], import.meta.url).href);
    for (const name of names) if (!(name in module)) missing.push(`${name} ← ${match[2]}`);
  }
  assert.deepEqual(missing, []);
});
