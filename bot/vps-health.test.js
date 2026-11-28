import test from "node:test";
import assert from "node:assert/strict";
import { createHealthWatch, healthProblems, readVpsHealth } from "./vps-health.js";

const G = 1024 ** 3;
test("VPS health: disk, memory and load thresholds; alerts only on change", () => {
  const h = readVpsHealth("/", { statfs: () => ({ bavail: 1, bsize: G, blocks: 50 }), mem: { free: 0.5 * G, total: 12 * G }, load: 9, cores: 4 });
  const problems = healthProblems(h);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /Disque presque plein : 1\.0 Go libres sur 50\.0 Go/);
  assert.deepEqual(healthProblems({ disk: { free: 30 * G, total: 50 * G }, memory: { free: 6 * G, total: 12 * G }, load: 1, cores: 4 }), []);
  const watch = createHealthWatch();
  assert.equal(watch([]), null);
  assert.equal(watch(problems).problems.length, 3);
  assert.equal(watch(problems), null, "pas de répétition");
  assert.deepEqual(watch([]), { recovered: true, problems: [] });
});
