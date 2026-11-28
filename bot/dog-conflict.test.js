// DOG — anti-conflit (deux bots qui se renvoient la laisse) et =dogfix.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-dog-conflict-"));
process.env.PND_DOG_STATE_PATH = join(directory, "dog-state.json");
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
writeFileSync(process.env.PND_DOG_STATE_PATH, "{}");

const { handleDogCommand, enforceLeashNickname, resetLeashRestoreGuardForTests } = await import("./dog-commands.js");
const { db } = await import("./database.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetLeashRestoreGuardForTests());

const SYS = "sysplus";
const settings = { sysPlus: { roleId: SYS } };

function makeGuild() {
  const roles = new Map();
  let nextId = 1;
  const members = new Map();
  const makeRole = (name, position = 2) => {
    const role = {
      id: `r${nextId++}`, name, managed: false, position, deleted: false,
      get members() { return new Map([...members.values()].filter((m) => m.roleIds.has(role.id)).map((m) => [m.id, m])); },
      setName: async (value) => { role.name = value; return role; },
      delete: async () => { role.deleted = true; roles.delete(role.id); return role; },
    };
    roles.set(role.id, role);
    return role;
  };
  const roleCache = { find: (p) => [...roles.values()].find(p), get: (id) => roles.get(id) };
  const bot = { id: "bot", permissions: { has: () => true }, roles: { highest: { position: 10 } } };
  const guild = {
    id: "g", name: "Serveur", ownerId: "guild-owner",
    roles: { cache: roleCache, create: async ({ name }) => makeRole(name), fetch: async (id) => roles.get(id) ?? null },
    members: {
      cache: { get: (id) => members.get(id) ?? null },
      fetch: async (arg) => members.get(typeof arg === "string" ? arg : arg?.user) ?? null,
      fetchMe: async () => bot,
    },
  };
  const makeMember = (id, displayName, roleIds = [], position = 1) => {
    const member = {
      id, guild, displayName, nickname: null, roleIds: new Set(roleIds),
      user: { id, username: displayName, tag: `${displayName}#0001`, bot: false },
      permissions: { has: () => false },
      roles: {
        highest: { position },
        get cache() { return new Map([...member.roleIds].map((rid) => [rid, roles.get(rid) ?? { id: rid, name: rid }])); },
        add: async (role) => { member.roleIds.add(typeof role === "string" ? role : role.id); },
        remove: async (role) => { member.roleIds.delete(typeof role === "string" ? role : role.id); },
      },
      voice: { channel: null },
      setNickname: async (value) => { member.nickname = value; },
    };
    members.set(id, member);
    return member;
  };
  return { guild, roles, makeRole, makeMember, members };
}

async function run(world, actorId, content, targetId) {
  const replies = [];
  const message = {
    content, guild: world.guild, member: world.members.get(actorId), author: world.members.get(actorId).user,
    mentions: { members: { first: () => world.members.get(targetId) } },
    reply: async (payload) => { replies.push(payload.content ?? payload); },
  };
  await handleDogCommand(message, settings);
  return replies.at(-1) ?? "";
}

function leash(world, pet, role, extra = {}) {
  writeFileSync(process.env.PND_DOG_STATE_PATH, JSON.stringify({
    [`g:${pet.id}`]: { guildId: "g", memberId: pet.id, ownerId: "ryan", ownerName: "Ryan", leashRoleId: role.id, since: Date.now(), previousNickname: null, ...extra },
  }));
}

test("une ancienne version qui remet sans cesse « 🐶 de … » et « En laisse » : le maintien est suspendu au lieu de boucler, puis =dogfix répare", async () => {
  const w = makeGuild();
  w.makeMember("ryan", "Ryan", [SYS], 5);
  const ownerRole = w.makeRole("En laisse (Ryan)");
  const legacy = w.makeRole("En laisse");
  const pet = w.makeMember("pet", "Pet", [ownerRole.id]);
  pet.nickname = "🦮 de Ryan";
  leash(w, pet, ownerRole);

  const conflicts = [];
  const oldBotStrikes = async () => {
    pet.nickname = "🐶 de Ryan";
    pet.roleIds.add(legacy.id);
    return enforceLeashNickname(pet, { onConflict: () => conflicts.push(1) });
  };
  for (let i = 0; i < 4; i++) {
    assert.equal(await oldBotStrikes(), true, `rétablissement ${i + 1} autorisé`);
    assert.equal(pet.nickname, "🦮 de Ryan");
    assert.ok(!pet.roleIds.has(legacy.id), "ancien rôle commun retiré");
  }
  assert.equal(await oldBotStrikes(), false, "5e rétablissement en une minute : suspendu");
  assert.equal(conflicts.length, 1, "conflit signalé une seule fois");
  assert.equal(await oldBotStrikes(), false, "toujours suspendu : plus de ping-pong");
  assert.equal(conflicts.length, 1);
  assert.equal(pet.nickname, "🐶 de Ryan");

  const reply = await run(w, "ryan", "=dogfix <@pet>", "pet");
  assert.match(reply, /remise d'aplomb/);
  assert.match(reply, /Conflit détecté/);
  assert.equal(pet.nickname, "🦮 de Ryan");
  assert.ok(pet.roleIds.has(ownerRole.id));
  assert.ok(!pet.roleIds.has(legacy.id));
});

test("le rôle de laisse d'un autre maître resté sur le membre est retiré", async () => {
  const w = makeGuild();
  w.makeMember("ryan", "Ryan", [SYS], 5);
  const ownerRole = w.makeRole("En laisse (Ryan)");
  const other = w.makeRole("En laisse (Alex)");
  const unrelated = w.makeRole("Membre");
  const pet = w.makeMember("pet", "Pet", [ownerRole.id, other.id, unrelated.id]);
  pet.nickname = "🦮 de Ryan";
  leash(w, pet, ownerRole);
  assert.equal(await enforceLeashNickname(pet), true);
  assert.ok(!pet.roleIds.has(other.id), "laisse de l'ancien maître retirée");
  assert.ok(pet.roleIds.has(ownerRole.id) && pet.roleIds.has(unrelated.id), "les autres rôles sont intacts");
});

test("=dogfix sur un membre sans laisse enregistrée retire les restes ; sur une laisse correcte, ne change rien", async () => {
  const w = makeGuild();
  w.makeMember("ryan", "Ryan", [SYS], 5);
  const legacy = w.makeRole("En laisse");
  const orphan = w.makeMember("orphan", "Orphan", [legacy.id]);
  orphan.nickname = "🐶 de Quelqu'un";
  writeFileSync(process.env.PND_DOG_STATE_PATH, "{}");
  assert.match(await run(w, "ryan", "=dogfix <@orphan>", "orphan"), /restes d'ancienne laisse retirés/);
  assert.equal(orphan.nickname, null);
  assert.ok(!orphan.roleIds.has(legacy.id));

  const ownerRole = w.makeRole("En laisse (Ryan)");
  const pet = w.makeMember("pet", "Pet", [ownerRole.id]);
  pet.nickname = "🦮 de Ryan";
  leash(w, pet, ownerRole);
  assert.match(await run(w, "ryan", "=dogfix <@pet>", "pet"), /est correcte.*Rien à réparer/);
});

test("=dogfix sans membre vérifie toutes les laisses du serveur", async () => {
  const w = makeGuild();
  w.makeMember("ryan", "Ryan", [SYS], 5);
  const ownerRole = w.makeRole("En laisse (Ryan)");
  const pet = w.makeMember("pet", "Pet", []);
  leash(w, pet, ownerRole);
  const reply = await run(w, "ryan", "=dogfix", null);
  assert.match(reply, /1 laisse\(s\) vérifiée\(s\), 1 remise\(s\) d'aplomb/);
  assert.equal(pet.nickname, "🦮 de Ryan");
  assert.ok(pet.roleIds.has(ownerRole.id));
});
