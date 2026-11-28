import assert from "node:assert/strict";
import test from "node:test";
import { CommandInteraction, MessageFlags } from "discord.js";
import { installDiscordCompat, modernizeResponseOptions } from "./discord-compat.js";

test("ephemeral becomes the Ephemeral flag, merged with existing flags", () => {
  assert.deepEqual(modernizeResponseOptions({ content: "x", ephemeral: true }).options, { content: "x", flags: MessageFlags.Ephemeral });
  assert.deepEqual(modernizeResponseOptions({ ephemeral: false, content: "x" }).options, { content: "x" });
  assert.equal(modernizeResponseOptions({ ephemeral: true, flags: MessageFlags.SuppressEmbeds }).options.flags, MessageFlags.SuppressEmbeds | MessageFlags.Ephemeral);
  assert.deepEqual(modernizeResponseOptions({ ephemeral: true, flags: [MessageFlags.SuppressEmbeds] }).options.flags, [MessageFlags.SuppressEmbeds, MessageFlags.Ephemeral]);
});

test("fetchReply becomes withResponse; other inputs are untouched", () => {
  const r = modernizeResponseOptions({ content: "x", fetchReply: true });
  assert.deepEqual(r, { options: { content: "x", withResponse: true }, fetchReply: true });
  const modern = { content: "x", flags: MessageFlags.Ephemeral };
  assert.equal(modernizeResponseOptions(modern).options, modern);
  assert.equal(modernizeResponseOptions("texte").options, "texte");
  class Payload { constructor() { this.ephemeral = true; } }
  const payload = new Payload();
  assert.equal(modernizeResponseOptions(payload).options, payload);
});

test("patched reply converts options and still returns the Message for fetchReply", async () => {
  const calls = [];
  const proto = CommandInteraction.prototype;
  const saved = proto.reply;
  proto.reply = async function (options) { calls.push(options); return options.withResponse ? { resource: { message: "MSG" } } : "RAW"; };
  try {
    installDiscordCompat();
    installDiscordCompat(); // idempotent
    const fake = Object.create(proto);
    assert.equal(await fake.reply({ content: "a", ephemeral: true }), "RAW");
    assert.equal(await fake.reply({ content: "b", fetchReply: true }), "MSG");
    assert.deepEqual(calls, [{ content: "a", flags: MessageFlags.Ephemeral }, { content: "b", withResponse: true }]);
  } finally {
    proto.reply = saved;
  }
});
