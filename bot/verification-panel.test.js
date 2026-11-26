import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-verif-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const v = await import("./verification-panel.js");
const { handleReactionVerificationReaction } = await import("./reaction-verification.js");
const raid = await import("./guard/raid-protection.js");
const { db } = await import("./database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("panel: server name (no product name), visible steps, CAPTCHA step mandatory in raid mode", () => {
  const normal = v.buildVerificationPanel({ guildName: "Mon serveur" });
  const text = JSON.stringify(normal);
  assert.match(normal.title, /Mon serveur/);
  assert.doesNotMatch(text, /PND|FWU/);
  assert.equal(normal.fields.length, 3);
  assert.match(normal.fields[2].name, /seulement pendant un raid/);
  assert.match(v.buildVerificationPanel({ guildName: "X", raid: true }).fields[2].name, /obligatoire/);
});

test("staff status lookup", () => {
  v.recordVerification("1", "2", "verified", "réaction");
  assert.match(v.verificationStatus("1", "2", { hasRole: true }).text, /vérifié[\s\S]*présent/);
  assert.match(v.verificationStatus("1", "3").text, /aucune vérification/);
});

function world() {
  const guildId = "100000000000000001";
  db.prepare("INSERT OR REPLACE INTO reaction_verification_panels(guild_id, channel_id, message_id, role_id, created_by, created_at) VALUES (?,?,?,?,?,?)").run(guildId, "c", "m", "500000000000000001", "x", 1);
  const added = [];
  const dms = [];
  const role = { id: "500000000000000001", managed: false, position: 1, permissions: 0n };
  const member = { id: "300000000000000001", roles: { cache: new Map(), add: async (r) => added.push(r) }, send: async (p) => dms.push(p) };
  const guild = { id: guildId, name: "Mon serveur", roles: { fetch: async () => role, cache: new Map([[role.id, role]]) }, members: { fetch: async () => member, fetchMe: async () => ({ permissions: { has: () => true }, roles: { highest: { position: 99 } } }) } };
  const reaction = { emoji: { name: "✅" }, partial: false, message: { id: "m", channelId: "c", guildId, guild } };
  return { reaction, added, dms, guildId };
}

test("reaction outside raid: role given, welcome message sent, status recorded", async () => {
  const { setRoleTiersForTests } = await import("./shared/tiers.js");
  setRoleTiersForTests("100000000000000001", []);
  const w = world();
  await handleReactionVerificationReaction(w.reaction, { id: "300000000000000001", bot: false });
  assert.equal(w.added.length, 1);
  assert.match(JSON.stringify(w.dms[0]), /Bienvenue/);
  assert.equal(v.verificationStatus(w.guildId, "300000000000000001").status, "verified");
});

test("reaction during a raid: no role, CAPTCHA required", async () => {
  const w = world();
  await raid.setRaidMode({ id: w.guildId }, true, { manual: true });
  await handleReactionVerificationReaction(w.reaction, { id: "300000000000000001", bot: false });
  assert.equal(w.added.length, 0);
  assert.match(JSON.stringify(w.dms[0]), /CAPTCHA/);
  assert.equal(v.verificationStatus(w.guildId, "300000000000000001").status, "pending_captcha");
});
