import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("PND_DATA_DIR moves the base and state files to a shared folder", () => {
  const shared = join(mkdtempSync(join(tmpdir(), "fwu-data-")), "fwu-data");
  const script = `const m = await import(${JSON.stringify(new URL("./data-dir.js", import.meta.url).href)}); console.log(m.DATA_DIR, m.dataPath("dog-state.json"));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, PND_DATA_DIR: shared } }).toString().trim();
  assert.equal(out, `${shared} ${join(shared, "dog-state.json")}`);
  assert.ok(existsSync(shared), "dossier créé");
});

test("without PND_DATA_DIR the historical bot/data folder is used", () => {
  const env = { ...process.env };
  delete env.PND_DATA_DIR;
  const script = `const m = await import(${JSON.stringify(new URL("./data-dir.js", import.meta.url).href)}); console.log(m.DATA_DIR);`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env }).toString().trim();
  assert.match(out, /bot[\\/]data[\\/]?$/);
});
