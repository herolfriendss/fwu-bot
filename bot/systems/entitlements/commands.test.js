import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-pack-cmd-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
process.env.PND_OWNER_DISCORD_ID = "123456";
const { db } = await import("../../database.js");
const { handlePackPrefix, handlePackInteraction } = await import("./commands.js");
const { activeEntitlementKeys } = await import("../../entitlements.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  delete process.env.PND_OWNER_DISCORD_ID;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD = "400000000000000001";
const OWNERS = "123456";

function prefixMessage(actorId, content) {
  const replies = [];
  return {
    replies,
    message: {
      content,
      guild: { id: GUILD },
      author: { id: actorId },
      reply: async (payload) => { replies.push(payload); },
    },
  };
}

test("prefix: a SYS+ admin who is not a PND owner cannot grant a pack", async () => {
  const { message, replies } = prefixMessage("999999", "=sysp pack grant server.tools permanent");
  await handlePackPrefix(message, ["grant", "server.tools", "permanent"], { configuredOwners: OWNERS });
  assert.match(replies.at(-1), /propriétaire PND/);
  assert.deepEqual(activeEntitlementKeys(GUILD), []);
});

test("prefix: a configured owner grants, then lists the pack", async () => {
  const grant = prefixMessage("123456", "=sysp pack grant server.tools 30");
  await handlePackPrefix(grant.message, ["grant", "server.tools", "30"], { configuredOwners: OWNERS });
  assert.match(grant.replies.at(-1).content, /attribué/);
  assert.deepEqual(activeEntitlementKeys(GUILD), ["server.tools"]);

  const list = prefixMessage("123456", "=sysp pack list");
  await handlePackPrefix(list.message, ["list"], { configuredOwners: OWNERS });
  assert.match(list.replies.at(-1).content, /server\.tools/);
});

test("prefix: invalid duration and unknown subcommand are refused without writing", async () => {
  const bad = prefixMessage("123456", "=sysp pack grant cloud dix");
  await handlePackPrefix(bad.message, ["grant", "cloud", "dix"], { configuredOwners: OWNERS });
  assert.match(bad.replies.at(-1), /Utilise/);
  const unknown = prefixMessage("123456", "=sysp pack wipe");
  await handlePackPrefix(unknown.message, ["wipe"], { configuredOwners: OWNERS });
  assert.match(unknown.replies.at(-1), /Utilise/);
  assert.deepEqual(activeEntitlementKeys(GUILD), ["server.tools"]);
});

test("slash: /sysp pack revoke by a configured owner removes access immediately", async () => {
  const [grant] = db.prepare("SELECT id FROM guild_entitlements WHERE guild_id=? AND revoked_at IS NULL").all(GUILD);
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "sysp",
    guildId: GUILD,
    user: { id: "123456" },
    options: {
      getSubcommand: () => "pack",
      getString: (name) => (name === "action" ? "revoke" : null),
      getInteger: (name) => (name === "id" ? grant.id : null),
    },
    reply: async (payload) => { replies.push(payload); },
  };
  assert.equal(await handlePackInteraction(interaction, { configuredOwners: OWNERS }), true);
  assert.equal(replies.at(-1).ephemeral, true);
  assert.match(replies.at(-1).content, /révoquée/);
  assert.deepEqual(activeEntitlementKeys(GUILD), []);
});

test("the card-pack root command /pack is never intercepted by the entitlement adapter", async () => {
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "pack",
    guildId: GUILD,
    user: { id: "123456" },
    options: { getSubcommand: () => null },
    reply: async () => { throw new Error("must not reply"); },
  };
  assert.equal(await handlePackInteraction(interaction, { configuredOwners: OWNERS }), false);
});
