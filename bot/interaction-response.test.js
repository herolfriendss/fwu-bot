import test from "node:test";
import assert from "node:assert/strict";
import { respondToInteraction } from "./interaction-response.js";

test("respondToInteraction uses editReply after deferReply", async () => {
  const calls = [];
  const interaction = {
    deferred: true, replied: false,
    reply: async (payload) => calls.push(["reply", payload]),
    editReply: async (payload) => calls.push(["editReply", payload]),
  };
  await respondToInteraction(interaction, { content: "Erreur", ephemeral: true }, { ephemeral: true });
  assert.deepEqual(calls, [["editReply", { content: "Erreur" }]]);
});

test("respondToInteraction uses editReply after an initial reply", async () => {
  const calls = [];
  const interaction = {
    deferred: false, replied: true,
    reply: async (payload) => calls.push(["reply", payload]),
    editReply: async (payload) => calls.push(["editReply", payload]),
  };
  await respondToInteraction(interaction, { content: "Mise à jour" });
  assert.deepEqual(calls, [["editReply", { content: "Mise à jour" }]]);
});

test("respondToInteraction creates an ephemeral first response when not acknowledged", async () => {
  const calls = [];
  const interaction = {
    deferred: false, replied: false,
    reply: async (payload) => calls.push(["reply", payload]),
    editReply: async (payload) => calls.push(["editReply", payload]),
  };
  await respondToInteraction(interaction, { content: "Erreur" }, { ephemeral: true });
  assert.deepEqual(calls, [["reply", { content: "Erreur", ephemeral: true }]]);
});

test("respondToInteraction does not attempt a second initial response", async () => {
  const calls = [];
  const interaction = {
    deferred: true, replied: false,
    reply: async () => calls.push("reply"),
    editReply: async () => calls.push("editReply"),
  };
  await respondToInteraction(interaction, { content: "Erreur" });
  assert.deepEqual(calls, ["editReply"]);
});
