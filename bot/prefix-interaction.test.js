import test from "node:test";
import assert from "node:assert/strict";
import { createPrefixInteraction } from "./prefix-interaction.js";

function fixture() {
  const sent = [];
  const message = {
    id: "m1",
    guild: { id: "123456789012345" },
    channel: { id: "234567890123456" },
    member: { permissions: { bitfield: 0n } },
    author: { id: "345678901234567", tag: "member#0001" },
    reply: async (payload) => { sent.push(payload); return payload; },
  };
  return { message, sent };
}

test("prefix interaction exposes message context and slash-like options", () => {
  const { message } = fixture();
  const role = { id: "456789012345678" };
  const interaction = createPrefixInteraction(message, "guildguard", "quarantine", { role });

  assert.equal(interaction.isChatInputCommand(), true);
  assert.equal(interaction.commandName, "guildguard");
  assert.equal(interaction.options.getSubcommand(), "quarantine");
  assert.equal(interaction.options.getRole("role", true), role);
  assert.equal(interaction.guildId, message.guild.id);
  assert.equal(interaction.user, message.author);
});

test("prefix interaction routes replies and strips interaction-only flags", async () => {
  const { message, sent } = fixture();
  const interaction = createPrefixInteraction(message, "ticket", "list");

  await interaction.deferReply({ ephemeral: true });
  assert.equal(interaction.deferred, true);
  await interaction.editReply({ content: "Liste", ephemeral: true, flags: 64 });
  assert.equal(interaction.replied, true);
  assert.equal(interaction.deferred, false);
  assert.deepEqual(sent, [{ content: "Liste" }]);
});

test("required options reject missing prefix arguments", () => {
  const { message } = fixture();
  const interaction = createPrefixInteraction(message, "voc", "limit");
  assert.throws(() => interaction.options.getInteger("nombre", true), /Argument manquant/);
});
