import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-owner-route-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
process.env.PND_OWNER_DISCORD_ID = "123456";
const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { pndBalance } = await import("./economy.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  delete process.env.PND_OWNER_DISCORD_ID;
  rmSync(directory, { recursive: true, force: true });
});

function interactionFor(commandName, actorId) {
  const replies = [];
  const member = { id: actorId, permissions: { has: () => true }, roles: { cache: { has: () => true } } };
  const target = { id: "654321", bot: false };
  return {
    replies,
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName,
    guildId: "guild-a",
    guild: { id: "guild-a", members: { fetch: async () => member } },
    user: { id: actorId },
    channel: { id: "channel-a" },
    options: {
      getUser: () => target,
      getInteger: () => 40,
    },
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };
}

test("slash PND adjustments require the configured owner even for privileged guild members", async () => {
  const sysAdmin = interactionFor("pnd-add", "999999");
  assert.equal(await handleV4SlashInteraction(sysAdmin), true);
  assert.equal(pndBalance("guild-a", "654321").balance, 0);
  assert.match(sysAdmin.replies.at(-1).content, /réservée au propriétaire PND configuré/i);

  const owner = interactionFor("pnd-add", "123456");
  assert.equal(await handleV4SlashInteraction(owner), true);
  assert.equal(pndBalance("guild-a", "654321").balance, 40);
  assert.match(owner.replies.at(-1).content, /40 PND/);

  const remove = interactionFor("pnd-remove", "123456");
  assert.equal(await handleV4SlashInteraction(remove), true);
  assert.equal(pndBalance("guild-a", "654321").balance, 0);
  assert.match(remove.replies.at(-1).content, /0 PND/);
  assert.equal(pndBalance("guild-b", "654321").balance, 0);
});
