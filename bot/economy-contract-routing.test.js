import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-contract-route-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { grantPnd, pndBalance } = await import("./economy.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function interactionFor(actorId, action, values = {}) {
  const replies = [];
  const member = { id: actorId, permissions: { has: () => false } };
  return {
    replies,
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "job",
    guild: { id: "guild-route", members: { fetch: async () => member } },
    user: { id: actorId },
    channel: { id: "channel-route" },
    options: {
      getSubcommandGroup: () => "contract",
      getSubcommand: () => action,
      getString: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
    },
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };
}

test("slash contract actions use the existing PND economy handler end to end", async () => {
  grantPnd("guild-route", "author", 50, "test_seed");
  const create = interactionFor("author", "create", {
    titre: "Préparer une soirée",
    description: "Créer le programme communautaire",
    recompense: 30,
  });
  assert.equal(await handleV4SlashInteraction(create), true);
  assert.match(create.replies[0].content, /Contrat \*\*#\d+\*\* publié/);
  const contractId = Number(create.replies[0].content.match(/#(\d+)/)?.[1]);

  const claim = interactionFor("worker", "claim", { id: contractId });
  assert.equal(await handleV4SlashInteraction(claim), true);
  const submit = interactionFor("worker", "submit", { id: contractId, "compte-rendu": "Programme prêt" });
  assert.equal(await handleV4SlashInteraction(submit), true);
  const approve = interactionFor("author", "approve", { id: contractId });
  assert.equal(await handleV4SlashInteraction(approve), true);
  assert.match(approve.replies[0].content, /30 PND versés/);
  assert.equal(pndBalance("guild-route", "worker").balance, 30);
});
