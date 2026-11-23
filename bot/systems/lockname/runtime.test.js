import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-lockname-rt-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
process.env.PND_OWNER_DISCORD_ID = "860000000000000001";
const { handleLocknameInteraction } = await import("./commands.js");
const { db } = await import("../../database.js");

const g = "860000000000000009";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

const member = (id, position, nickname = null) => ({
  id,
  nickname,
  displayName: nickname ?? id,
  user: { id, bot: false },
  roles: { highest: { position }, cache: new Map() },
  permissions: { has: () => true },
  guild: { id: g, ownerId: "860000000000000099" },
});
const actor = member("860000000000000001", 50);
const target = member("860000000000000002", 5, "Pseudo");
const bot = member("860000000000000003", 99);
const guild = {
  id: g,
  ownerId: "860000000000000099",
  members: {
    fetch: async ({ user }) =>
      user === actor.id ? actor : user === target.id ? target : null,
    fetchMe: async () => bot,
  },
  channels: { fetch: async () => null },
};

function interaction(sub) {
  const log = [];
  return {
    log,
    guild,
    user: { id: actor.id },
    commandName: "lockname",
    isChatInputCommand: () => true,
    inGuild: () => true,
    options: { getSubcommand: () => sub, getUser: () => target.user },
    deferReply: async () => {},
    editReply: async (p) => {
      log.push(p);
    },
    reply: async (p) => {
      log.push(p);
    },
  };
}
const isProtected = () =>
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM protected_nicknames WHERE guild_id=? AND member_id=?",
      )
      .get(g, target.id),
  );

test("regression: /lockname proteger protects (it used to run 'remove'), retirer removes, liste lists", async () => {
  const protect = interaction("proteger");
  await handleLocknameInteraction(protect, {});
  assert.equal(isProtected(), true, JSON.stringify(protect.log));
  const list = interaction("liste");
  await handleLocknameInteraction(list, {});
  assert.match(String(list.log[0]), /Pseudo/);
  await handleLocknameInteraction(interaction("retirer"), {});
  assert.equal(isProtected(), false);
});
