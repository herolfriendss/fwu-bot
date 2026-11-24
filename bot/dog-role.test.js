// DOG — rôle « En laisse (Pseudo du maître) » : un par maître, partagé, supprimé après la dernière laisse.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-dog-role-"));
process.env.PND_DOG_STATE_PATH = join(directory, "dog-state.json");
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
writeFileSync(process.env.PND_DOG_STATE_PATH, "{}");

const { handleDogCommand, enforceLeashNickname } = await import("./dog-commands.js");
const { db } = await import("./database.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

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

test("deux laisses du même maître partagent « En laisse (Ryan) » ; un autre maître a son propre rôle ; le rôle disparaît après la dernière laisse", async () => {
  const w = makeGuild();
  w.makeMember("ryan", "Ryan", [SYS], 5);
  w.makeMember("alex", "Alex", [SYS], 5);
  const a = w.makeMember("pet-a", "PetA");
  const b = w.makeMember("pet-b", "PetB");
  const c = w.makeMember("pet-c", "PetC");

  assert.match(await run(w, "ryan", "=dog <@pet-a>", "pet-a"), /en laisse par \*\*Ryan\*\*/);
  await run(w, "ryan", "=dog <@pet-b>", "pet-b");
  await run(w, "alex", "=dog <@pet-c>", "pet-c");

  const names = [...w.roles.values()].map((r) => r.name).sort();
  assert.deepEqual(names, ["En laisse (Alex)", "En laisse (Ryan)"], "un rôle par maître, aucun doublon");
  const ryanRole = [...w.roles.values()].find((r) => r.name === "En laisse (Ryan)");
  assert.ok(a.roleIds.has(ryanRole.id) && b.roleIds.has(ryanRole.id));
  assert.ok(!c.roleIds.has(ryanRole.id));

  await run(w, "ryan", "=undog <@pet-a>", "pet-a");
  assert.ok(w.roles.has(ryanRole.id), "encore utilisé par PetB : conservé");
  await run(w, "ryan", "=undog <@pet-b>", "pet-b");
  assert.equal(ryanRole.deleted, true, "plus aucune laisse de Ryan : rôle supprimé");
  assert.deepEqual([...w.roles.values()].map((r) => r.name), ["En laisse (Alex)"]);
});

test("une laisse en cours avec l'ancien rôle commun « En laisse » passe au rôle du maître", async () => {
  const w = makeGuild();
  w.makeMember("ryan", "Ryan", [SYS], 5);
  const shared = w.makeRole("En laisse");
  const pet = w.makeMember("pet-old", "PetOld", [shared.id]);
  pet.nickname = "🐶 de Ryan";
  writeFileSync(process.env.PND_DOG_STATE_PATH, JSON.stringify({
    "g:pet-old": { guildId: "g", memberId: "pet-old", ownerId: "ryan", ownerName: "Ryan", leashRoleId: shared.id, since: Date.now(), previousNickname: null },
  }));
  await enforceLeashNickname(pet);
  const ownerRole = [...w.roles.values()].find((r) => r.name === "En laisse (Ryan)");
  assert.ok(ownerRole, "rôle du maître créé");
  assert.ok(pet.roleIds.has(ownerRole.id));
  assert.ok(!pet.roleIds.has(shared.id), "ancien rôle commun retiré");
  assert.equal(pet.nickname, "🦮 de Ryan", "ancien pseudo 🐶 remplacé par 🦮");
});
