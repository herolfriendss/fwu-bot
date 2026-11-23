import test from "node:test";
import assert from "node:assert/strict";
import { respondInPlace, respondInPlaceSafe } from "./interaction-reply.js";
import { handlePanelSetupInteraction } from "./systems/setup/panel-setup.js";

function fake({ deferred = false, replied = false } = {}) {
  const calls = [];
  return {
    calls,
    deferred,
    replied,
    reply: async (p) => calls.push(["reply", p]),
    editReply: async (p) => calls.push(["editReply", p]),
    followUp: async (p) => {
      calls.push(["followUp", p]);
    },
  };
}

test("not answered yet: a normal reply is sent", async () => {
  const interaction = fake();
  await respondInPlace(interaction, { content: "x", ephemeral: true });
  assert.deepEqual(
    interaction.calls.map(([name]) => name),
    ["reply"],
  );
  assert.equal(interaction.calls[0][1].ephemeral, true);
});

test("deferred or replied: the existing message is edited, never followed up", async () => {
  for (const state of [{ deferred: true }, { replied: true }]) {
    const interaction = fake(state);
    await respondInPlace(interaction, {
      content: "❌ erreur",
      ephemeral: true,
      flags: 64,
      allowedMentions: { parse: [] },
    });
    assert.deepEqual(
      interaction.calls.map(([name]) => name),
      ["editReply"],
    );
    assert.deepEqual(interaction.calls[0][1], {
      content: "❌ erreur",
      allowedMentions: { parse: [] },
    });
  }
});

test("a string payload becomes the content, and the safe variant swallows failures", async () => {
  const interaction = fake({ deferred: true });
  await respondInPlace(interaction, "texte");
  assert.deepEqual(interaction.calls[0][1], { content: "texte" });
  interaction.editReply = async () => {
    throw new Error("Unknown Message");
  };
  assert.equal(await respondInPlaceSafe(interaction, "x"), null);
});

test("/setup refusal after a deferral edits the reply instead of posting a follow-up", async () => {
  const interaction = {
    ...fake({ deferred: true }),
    isChatInputCommand: () => true,
    commandName: "setup",
    customId: "",
    inGuild: () => true,
    user: { id: "1" },
    guild: { members: { fetch: async () => null } }, // member cannot be verified -> not authorised
  };
  assert.equal(
    await handlePanelSetupInteraction(
      interaction,
      {},
      { apiUrl: "http://x", secret: "s" },
    ),
    true,
  );
  assert.deepEqual(
    interaction.calls.map(([name]) => name),
    ["editReply"],
  );
  assert.match(interaction.calls[0][1].content, /Configuration réservée/);
});

test("/setup outside a guild after a reply edits that reply as well", async () => {
  const interaction = {
    ...fake({ replied: true }),
    isChatInputCommand: () => true,
    commandName: "setup",
    customId: "",
    inGuild: () => false,
    user: { id: "1" },
    guild: null,
  };
  await handlePanelSetupInteraction(
    interaction,
    {},
    { apiUrl: "http://x", secret: "s" },
  );
  assert.deepEqual(
    interaction.calls.map(([name]) => name),
    ["editReply"],
  );
});

test("global failure net: replies, replaces a deferred placeholder, never touches an answered or panel interaction", async () => {
  const { reportInteractionFailure } = await import("./interaction-reply.js");
  const make = (state) => {
    const calls = [];
    return { calls, ...state, isRepliable: () => true, isMessageComponent: () => Boolean(state.component), isModalSubmit: () => false,
      reply: async (p) => calls.push(["reply", p]), editReply: async (p) => calls.push(["editReply", p]), followUp: async (p) => calls.push(["followUp", p]) };
  };
  const fresh = make({ replied: false, deferred: false });
  await reportInteractionFailure(fresh);
  assert.equal(fresh.calls[0][0], "reply");
  const deferred = make({ replied: false, deferred: true });
  await reportInteractionFailure(deferred);
  assert.equal(deferred.calls[0][0], "editReply");
  assert.equal("components" in deferred.calls[0][1], false, "panels/components are preserved");
  const panel = make({ replied: false, deferred: true, component: true });
  await reportInteractionFailure(panel);
  assert.equal(panel.calls[0][0], "followUp");
  assert.equal(panel.calls[0][1].ephemeral, true);
  const answered = make({ replied: true, deferred: false });
  await reportInteractionFailure(answered);
  assert.equal(answered.calls.length, 0);
});
