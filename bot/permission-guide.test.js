import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-guide-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const guide = await import("./permission-guide.js");
const { MATRIX_TIERS, buildPermissionMatrix } = await import("./permission-matrix.js");
const { TIER_LABELS } = await import("./shared/tiers.js");
const { CASE_ACTIONS } = await import("./log-events.js");
const { SENSITIVE_ACTIONS } = await import("./reply-layer.js");
const { db } = await import("./database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const matrix = buildPermissionMatrix({ guildId: "1", guildOwnerId: "2", sysPlusRoleId: "3", adminPlusRoleId: "4", whitelistRoleId: "5" });
const text = (embeds) => JSON.stringify(embeds);

test("the public guide cites every rank, every tier and every sanction present in the code", () => {
  const all = text(guide.buildPublicGuide({ matrix, roles: { sysPlus: "3", adminPlus: "4", whitelist: "5" } }));
  for (const tier of MATRIX_TIERS) assert.ok(all.includes(tier.label), tier.label);
  for (const label of Object.values(TIER_LABELS)) assert.ok(all.includes(label), label);
  for (const word of ["SYS+", "ADMIN+", "WHITELIST", "BLR", "DOG", "Menottes", "Quarantaine", "Blacklist", "Tempmute", "Avertissement", "Expulsion", "Bannissement"]) assert.ok(all.includes(word), word);
  // Toute sanction sensible ou à dossier du code a son entrée dans le guide.
  const keys = new Set(guide.GUIDE_SANCTIONS.map((s) => s.key));
  for (const path of Object.keys(SENSITIVE_ACTIONS)) {
    const root = path.split(" ")[0].replace("quarantaine", "quarantaine");
    if (root === "sanction") continue;
    assert.ok(keys.has(root), `sanction ${root} absente du guide`);
  }
  for (const action of ["ban", "kick", "tempmute", "warn", "dog", "menotte"]) assert.ok(CASE_ACTIONS.has(action) && keys.has(action), action);
  assert.doesNotMatch(all, /FWU|PND/);
  assert.match(all, /Mis à jour le <t:/);
});

test("the staff guide details the full matrix and procedures", () => {
  const staff = text(guide.buildStaffGuide({ matrix, roles: { whitelist: "5" } }));
  for (const row of matrix.rows) assert.ok(staff.includes(row.label.replace(/"/g, '\\"')), row.label);
  assert.match(staff, /BLR/);
});

test("exact quotas appear per tier", () => {
  const all = text(guide.buildPublicGuide({ matrix, quotas: [{ command: "ban", tier: 10, maxUses: 3, windowSeconds: 86_400 }, { command: "ban", tier: 1, maxUses: null, windowSeconds: 3600 }] }));
  assert.match(all, /\/ban\*\* — 10 % : 3 \/ 1 j · 1 % : illimité/);
});

test("/pourquoi explains for the person who asks", () => {
  const member = { id: "9", guild: { ownerId: "2" }, roles: { cache: { has: (id) => id === "3" } }, permissions: { has: () => false } };
  const out = guide.explainCommand({ matrix, commandPath: "/ban", member, roles: { sysPlus: "3" }, env: {} });
  assert.match(out, /Ton rang : SYS\+/);
  assert.match(out, /quotas/);
});
