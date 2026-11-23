import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-anti-move-store-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
// The configured PND Owner is the sole implicit SYS+ principal in tests.
process.env.PND_OWNER_DISCORD_ID = "100000000000000103";
const store = await import("./anti-move.js");
const { db } = await import("./database.js");
const guildA = "100000000000000101";
const guildB = "100000000000000102";
const actor = "100000000000000103";
const member = "100000000000000104";

after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

test("anti-move config is off by default and persists per guild", () => {
  assert.deepEqual(store.getAntiMoveConfig(guildA), { enabled: false });
  assert.deepEqual(store.setAntiMoveEnabled(guildA, true, actor), { enabled: true });
  assert.deepEqual(store.getAntiMoveConfig(guildA), { enabled: true });
  assert.deepEqual(store.getAntiMoveConfig(guildB), { enabled: false });
  assert.deepEqual(store.setAntiMoveEnabled(guildA, false, actor), { enabled: false });
});

test("protected members are unique and isolated by guild", () => {
  assert.equal(store.protectAntiMoveMember(guildA, member, actor), true);
  assert.equal(store.protectAntiMoveMember(guildA, member, actor), false);
  assert.equal(store.isAntiMoveProtected(guildA, member), true);
  assert.equal(store.isAntiMoveProtected(guildB, member), false);
  assert.equal(store.listAntiMoveProtectedMembers(guildA).length, 1);
  assert.equal(store.unprotectAntiMoveMember(guildA, member), true);
  assert.equal(store.unprotectAntiMoveMember(guildA, member), false);
});

test("exceptions are unique, persistent and guild-scoped", () => {
  assert.equal(store.addAntiMoveExemption(guildA, member, actor), true);
  assert.equal(store.addAntiMoveExemption(guildA, member, actor), false);
  assert.equal(store.listAntiMoveExemptions(guildA).length, 1);
  assert.equal(store.listAntiMoveExemptions(guildB).length, 0);
  assert.equal(store.removeAntiMoveExemption(guildA, member), true);
  assert.equal(store.removeAntiMoveExemption(guildA, member), false);
});


test("anti-move prefix command configures protection and an individual exemption", async () => {
  const owner = { id: actor, guild: { id: guildA, ownerId: actor }, permissions: { has: () => false } };
  const targetMember = { id: member, user: { bot: false } };
  const replies = [];
  const botMember = { permissions: { has: () => true } };
  const guild = { id: guildA, ownerId: actor, members: {
    fetch: async (id) => id === member ? targetMember : null,
    fetchMe: async () => botMember,
  } };
  const makeMessage = (content) => ({
    guild,
    member: owner,
    author: { id: actor },
    content,
    mentions: { members: { first: () => null } },
    reply: async (payload) => { replies.push(payload); },
  });

  assert.equal(await store.handleAntiMoveMessage(makeMessage("=anti-moove config on")), true);
  assert.equal(store.getAntiMoveConfig(guildA).enabled, true);
  assert.equal(await store.handleAntiMoveMessage(makeMessage(`=anti-moove proteger <@${member}>`)), true);
  assert.equal(store.isAntiMoveProtected(guildA, member), true);
  assert.equal(await store.handleAntiMoveMessage(makeMessage(`=anti-moove exception-ajouter <@${member}>`)), true);
  assert.equal(store.listAntiMoveExemptions(guildA).length, 1);
  assert.equal(replies.length, 3);
});
