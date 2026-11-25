import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P } from "discord.js";

process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
const { commandFrozen, freezeRefusal, rememberFreeze, resetFreezeCacheForTests, cachedFreezeUntil } = await import("./staff-freeze-gate.js");
const { setRoleTiersForTests } = await import("./shared/tiers.js");

const G = "200000000000000001";
const member = (id, { roles = [], perms = [] } = {}) => ({
  id, guild: { id: G },
  permissions: { has: (bit) => perms.includes(bit) },
  roles: { cache: new Map(roles.map((r) => [r, { id: r }])) },
});

test("catégories et commandes de pouvoir gelées ; /status et les commandes des membres non", () => {
  assert.equal(commandFrozen({ commandName: "sysp", category: "SYS+" }), true);
  assert.equal(commandFrozen({ commandName: "dog", category: "Vocal & DOG" }), true);
  assert.equal(commandFrozen({ commandName: "rankall", category: "" }), true);
  assert.equal(commandFrozen({ commandName: "status", category: "Général" }), false);
  assert.equal(commandFrozen({ commandName: "balance", category: "Économie PND" }), false);
  assert.equal(commandFrozen({ commandName: "", prefixed: true }), true);
});

test("pendant un gel : staff refusé, owner et membres simples servis ; sans gel rien n'est bloqué", async () => {
  resetFreezeCacheForTests();
  setRoleTiersForTests(G, [["modrole", 10]]);
  const settings = { [G]: { sysPlus: { roleId: "sysrole" } } };
  const mod = member("300000000000000001", { roles: ["modrole"] });
  assert.equal(await freezeRefusal({ guildId: G, member: mod, commandName: "warn", category: "Modération", settings }), null, "pas de gel");
  rememberFreeze(G, Date.now() + 3_600_000);
  assert.match(await freezeRefusal({ guildId: G, member: mod, commandName: "warn", category: "Modération", settings }), /gelé/);
  assert.match(await freezeRefusal({ guildId: G, member: member("3", { roles: ["sysrole"] }), commandName: "dog", category: "Vocal & DOG", settings }), /gelé/);
  assert.match(await freezeRefusal({ guildId: G, member: member("4", { perms: [P.ManageRoles] }), prefixed: true, settings }), /gelé/);
  assert.equal(await freezeRefusal({ guildId: G, member: member("100000000000000001", { roles: ["sysrole"] }), commandName: "sysp", category: "SYS+", settings }), null, "owner");
  assert.equal(await freezeRefusal({ guildId: G, member: member("5"), prefixed: true, settings }), null, "membre simple");
  rememberFreeze(G, Date.now() - 1);
  assert.equal(cachedFreezeUntil(G), null, "gel expiré");
});
