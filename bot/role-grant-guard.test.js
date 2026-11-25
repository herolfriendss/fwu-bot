import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-role-guard-")), "db.sqlite");
const OWNER = "100000000000000001";
process.env.PND_OWNER_DISCORD_ID = OWNER;
delete process.env.SHARED_DATABASE_URL;

const {
  privilegedPermissionNames, stripPrivilegedPermissions, protectedRoleReason, roleGrantRefusal, filterGrantableRoleIds,
} = await import("./role-grant-guard.js");
const { setRoleTiersForTests, forgetTierCache, resolveTier } = await import("./shared/tiers.js");
const { isTier0Role } = await import("./tier0-shield.js");
const { memberRolePosition } = await import("./systems/sysplus/member-roles.js");
const { normalizeCustomRoleName } = await import("./systems/sysplus/custom-roles-policy.js");

const G = "200000000000000001";
const ADMIN = 1n << 3n;
const BAN = 1n << 2n;
const MOVE = 1n << 24n;
const SEND = 1n << 11n;

function guild(roles = []) {
  return { id: G, roles: { cache: new Map(roles.map((r) => [r.id, r])), fetch: async (id) => roles.find((r) => r.id === id) ?? null } };
}

test("permissions sensibles : détectées (y compris Déplacer), les ordinaires passent", () => {
  assert.deepEqual(privilegedPermissionNames(String(SEND)), []);
  assert.deepEqual(privilegedPermissionNames(String(ADMIN | SEND)), ["Administrator"]);
  assert.deepEqual(privilegedPermissionNames({ bitfield: MOVE }), ["MoveMembers"]);
  assert.deepEqual(privilegedPermissionNames("pas un nombre"), ["inconnues"], "illisible = refusé");
  const clean = stripPrivilegedPermissions(String(ADMIN | BAN | SEND));
  assert.equal(BigInt(clean.permissions), SEND);
  assert.deepEqual(clean.stripped.sort(), ["Administrator", "BanMembers"]);
});

test("rôles protégés : SYS+, ADMIN+, WHITELIST, paliers 0 à 50 %, permissions sensibles", () => {
  const access = { sysPlus: "sys", adminPlus: "adm", whitelist: "wl" };
  const tiers = new Map([["t0", 0], ["t10", 10], ["t50", 50], ["t100", 100]]);
  const reason = (id, permissions = 0n) => protectedRoleReason({ role: { id, permissions }, guildId: G, tiers, access });
  for (const id of ["sys", "adm", "wl", "t0", "t10", "t50"]) assert.ok(reason(id), `${id} protégé`);
  assert.equal(reason("t100"), null, "le palier 100 % (tous les membres) reste donnable");
  assert.equal(reason("cosmetique"), null);
  assert.ok(reason("modo", BAN));
  assert.ok(protectedRoleReason({ role: { id: G }, guildId: G }), "@everyone");
  assert.ok(protectedRoleReason({ role: { id: "bot", managed: true }, guildId: G }), "rôle d'intégration");
  assert.equal(protectedRoleReason({ role: { id: "modo", permissions: BAN }, guildId: G, removal: true }), null, "retirer un rôle à permissions reste possible");
  assert.ok(protectedRoleReason({ role: { id: "t10" }, guildId: G, tiers, removal: true }), "retirer un palier : OWNER seul");
});

test("le NOM d'un rôle ne protège jamais et ne donne jamais de palier", () => {
  forgetTierCache();
  const named = { id: "perso", name: "Moi 0 %", permissions: 0n };
  assert.equal(isTier0Role(named, new Map()), false, "« Moi 0 % » n'est pas intouchable");
  assert.equal(isTier0Role(named, new Map([["perso", 0]])), true, "seule l'association explicite compte");
  assert.equal(resolveTier({ userId: "u", roles: [{ id: "x", name: "1% All Access" }] }), null);
  assert.equal(resolveTier({ userId: "u", roles: [{ id: "x", name: "Staff" }], explicit: new Map([["x", 10]]) }), 10);
  assert.throws(() => normalizeCustomRoleName("Moi 0 %"), /%/);
  assert.throws(() => normalizeCustomRoleName("Moi 0 ％"), /%/, "variante pleine chasse");
});

test("roleGrantRefusal : seul l'OWNER donne un rôle de palier ; les automatismes jamais", async () => {
  setRoleTiersForTests(G, [["r10", 10]]);
  const g = guild([{ id: "r10", permissions: 0n }, { id: "ok", permissions: SEND }, { id: "adm", permissions: ADMIN }]);
  const r10 = g.roles.cache.get("r10");
  assert.match(await roleGrantRefusal(g, r10, { actorId: "300000000000000001" }), /palier 10/);
  assert.equal(await roleGrantRefusal(g, r10, { actorId: OWNER }), null, "l'OWNER peut");
  assert.match(await roleGrantRefusal(g, r10, { actorId: OWNER, automatic: true }), /palier/, "pas d'exception pour un automatisme");
  assert.equal(await roleGrantRefusal(g, g.roles.cache.get("ok"), { actorId: "300000000000000001" }), null);
  assert.match(await roleGrantRefusal(g, { id: "sys", permissions: 0n }, { actorId: "300000000000000001", settings: { sysPlus: { roleId: "sys" } } }), /SYS\+/);
  assert.match(await roleGrantRefusal(g, { id: "wl", permissions: 0n }, { actorId: "300000000000000001", settings: { sysPlus: { whitelistRoleId: "wl" } } }), /WHITELIST/);
  const refused = [];
  const kept = await filterGrantableRoleIds(g, ["r10", "ok", "adm", "absent"], { onRefused: (id) => refused.push(id) });
  assert.deepEqual(kept, ["ok"]);
  assert.deepEqual(refused, ["r10", "adm", "absent"]);
  forgetTierCache();
});

test("rôle perso : placé au niveau du membre, jamais au-dessus de l'auteur ni du bot", () => {
  assert.equal(memberRolePosition({ actorPosition: 20, botPosition: 30, actorFull: false, targetPosition: 3 }), 3, "le membre ne gagne aucun rang");
  assert.equal(memberRolePosition({ actorPosition: 20, botPosition: 30, actorFull: false, targetPosition: 25 }), 19, "plafonné sous l'auteur");
  assert.equal(memberRolePosition({ actorPosition: 20, botPosition: 30, actorFull: true, targetPosition: 40 }), 29, "plafonné sous le bot");
});
