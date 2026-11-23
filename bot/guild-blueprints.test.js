import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-blueprints-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { createGuildBlueprint, getGuildBlueprintSnapshot, listGuildBlueprints, compareGuildBlueprint, buildGuildBlueprintSnapshot } = await import("./guild-blueprints.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

function makeGuild({ channelName = "general", roleName = "Membre" } = {}) {
  const role = { id: "333333", name: roleName, color: 0, hoist: false, mentionable: false, permissions: { bitfield: 8n }, position: 1, managed: false };
  const everyone = { ...role, id: "123456", name: "@everyone", position: 0 };
  const overwrite = { id: "333333", type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 0n } };
  const channel = { id: "222222", name: channelName, type: 0, parentId: null, position: 0, topic: "Hello", nsfw: false, rateLimitPerUser: 0, bitrate: 0, userLimit: 0, permissionOverwrites: { cache: new Map([[overwrite.id, overwrite]]) }, isThread: () => false };
  return { id: "123456", name: "PND", roles: { cache: new Map([[everyone.id, everyone], [role.id, role]]) }, channels: { cache: new Map([[channel.id, channel]]) } };
}

test("blueprints are guild-scoped, bounded and compare structure without applying changes", () => {
  const guild = makeGuild();
  assert.throws(() => createGuildBlueprint(guild, "Avant", "654321"), /réservée à SYS/);
  const created = createGuildBlueprint(guild, "Avant", "654321", { authorizeActor: () => true, now: 1000 });
  assert.equal(created.roleCount, 2);
  assert.equal(created.channelCount, 1);
  const exported = getGuildBlueprintSnapshot(guild.id, created.blueprintId);
  assert.equal(exported.checksum, created.checksum);
  assert.equal(exported.snapshot.roles.length, 2);
  assert.throws(() => getGuildBlueprintSnapshot("999999", created.blueprintId), /introuvable/);
  const changed = makeGuild({ channelName: "annonces", roleName: "Membre+" });
  const diff = compareGuildBlueprint(changed, created.blueprintId, 2000);
  assert.equal(diff.channels.modified.length, 1);
  assert.equal(diff.roles.modified.length, 1);
  assert.equal(diff.channels.modified[0].after, "annonces");
  assert.equal(listGuildBlueprints("999999").length, 0);
  assert.throws(() => compareGuildBlueprint({ ...changed, id: "999999" }, created.blueprintId), /introuvable/);
  assert.deepEqual(buildGuildBlueprintSnapshot(guild, 3000).channels[0].permissionOverwrites[0], { id: "333333", type: 0, allow: "1024", deny: "0" });
  db.prepare("UPDATE guild_blueprints SET snapshot_json='{}' WHERE guild_id=? AND blueprint_id=?").run(guild.id, created.blueprintId);
  assert.throws(() => compareGuildBlueprint(guild, created.blueprintId), /Intégrité du blueprint invalide/);
});

test("blueprint retention keeps at most twenty snapshots per guild", () => {
  const guild = makeGuild();
  for (let i = 0; i < 22; i++) createGuildBlueprint(guild, `Backup ${i}`, "654321", { authorizeActor: () => true, now: 10_000 + i });
  assert.equal(listGuildBlueprints(guild.id).length, 20);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM guild_blueprints WHERE guild_id=?").get(guild.id).count, 20);
});
