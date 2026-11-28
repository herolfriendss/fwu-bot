import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-prole-")), "db.sqlite");
process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
const p = await import("./personal-role-panel.js");
const { db } = await import("../../database.js");

const G = "111111111111111111";

test("public panel: title, four features, one button, no product name", () => {
  const panel = p.publicPanel();
  const e = panel.embeds[0].toJSON();
  assert.match(e.title, /Rôles personnels — Espace membres/);
  for (const word of ["Nom & couleur", "Émoji / icône", "Membres", "Protection"]) assert.match(e.description, new RegExp(word));
  assert.equal(panel.components[0].toJSON().components[0].custom_id, "prole:open");
  assert.doesNotMatch(JSON.stringify(e), /FWU/);
});

test("self-creation is closed by default and limited to eligible roles", () => {
  assert.match(p.selfCreateDecision({ hasRole: false, memberRoleIds: ["a"], eligible: [], guildCount: 0 }), /pas ouverte/);
  assert.match(p.selfCreateDecision({ hasRole: false, memberRoleIds: ["a"], eligible: ["booster"], guildCount: 0 }), /réservée/);
  assert.equal(p.selfCreateDecision({ hasRole: false, memberRoleIds: ["booster"], eligible: ["booster"], guildCount: 0 }), null);
  assert.match(p.selfCreateDecision({ hasRole: true, memberRoleIds: ["booster"], eligible: ["booster"], guildCount: 0 }), /déjà/);
  assert.match(p.selfCreateDecision({ hasRole: false, memberRoleIds: ["booster"], eligible: ["booster"], guildCount: 100 }), /Limite/);
  p.setEligibleRoles(G, ["r1", "r1", "r2"], "sys");
  assert.deepEqual(p.eligibleRoleIds(G), ["r1", "r2"]);
});

test("emoji icon: exactly one emoji, empty removes", () => {
  assert.equal(p.normalizeRoleEmoji("👑"), "👑");
  assert.equal(p.normalizeRoleEmoji("👨‍👩‍👧"), "👨‍👩‍👧");
  assert.equal(p.normalizeRoleEmoji(""), null);
  assert.throws(() => p.normalizeRoleEmoji("👑👑"), /un seul émoji/);
  assert.throws(() => p.normalizeRoleEmoji("abc"), /un seul émoji/);
});

test("protection: permissions always removed; name, colour, icon restored only when enabled", () => {
  const role = (over = {}) => ({ id: "role1", name: "Mon rôle", color: 0xff0000, unicodeEmoji: null, permissions: { bitfield: 0n }, ...over });
  assert.equal(p.restorePlan(role(), { enabled: false, name: "x", color: 1, icon: null }), null);
  assert.deepEqual(p.restorePlan(role({ permissions: { bitfield: 8n } }), { enabled: false }), { permissions: [] });
  assert.deepEqual(p.restorePlan(role({ name: "Volé", color: 1 }), { enabled: true, name: "Mon rôle", color: 0xff0000, icon: "👑" }), { name: "Mon rôle", color: 0xff0000, unicodeEmoji: "👑" });
  assert.equal(p.restorePlan(role(), { enabled: true, name: "Mon rôle", color: 0xff0000, icon: null }), null);
});

test("role update event: a stranger's edit is reverted on a protected personal role, other roles untouched", async () => {
  db.prepare("INSERT INTO sysplus_member_roles(guild_id,member_id,role_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(G, "m1", "role1", "sys", 1, 1);
  p.saveSnapshot(G, { id: "role1", name: "Mon rôle", color: 0xff0000, unicodeEmoji: null }, "m1", { enabled: true });
  const edits = [];
  const codes = [];
  const role = { id: "role1", guild: { id: G }, name: "Piraté", color: 0xff0000, unicodeEmoji: null, permissions: { bitfield: 8n }, edit: async (c) => { edits.push(c); } };
  assert.equal(await p.enforcePersonalRole(role, { record: (c) => codes.push(c) }), true);
  assert.deepEqual(edits[0], { permissions: [], name: "Mon rôle" });
  assert.deepEqual(codes, ["personal_role_restored"]);
  assert.equal(await p.enforcePersonalRole({ ...role, id: "other", edit: async () => assert.fail() }), false);
});

test("member update event: the owner gets the role back only when protection is on", async () => {
  const adds = [];
  const member = (has) => ({ id: "m1", guild: { id: G }, roles: { cache: new Map(has ? [["role1", {}]] : []), add: async (r) => adds.push(r) } });
  assert.equal(await p.restoreOwnerRole(member(true), member(false)), true);
  assert.deepEqual(adds, ["role1"]);
  p.saveSnapshot(G, { id: "role1", name: "Mon rôle", color: 0xff0000 }, "m1", { enabled: false });
  assert.equal(await p.restoreOwnerRole(member(true), member(false)), false);
});

test("member view: buttons for the four features, honest about permissions", () => {
  const v = p.memberView({ id: "role1", name: "Mon rôle", hexColor: "#ff0000", unicodeEmoji: "👑" }, { holders: 3, protection: { enabled: true } });
  const d = v.embeds[0].toJSON().description;
  assert.match(d, /jamais de permission/);
  assert.match(d, /Membres qui l'ont : 3/);
  const ids = v.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
  assert.deepEqual(ids, ["prole:style", "prole:icon", "prole:protect", "prole:give", "prole:take"]);
  assert.match(p.memberView(null, { canCreate: "Demande au staff." }).content, /Demande au staff/);
});
