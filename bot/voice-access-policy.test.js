import test from "node:test";
import assert from "node:assert/strict";
import { chooseVoiceRequestDestination, isVoiceAccessEntryPointContext } from "./voice-access-policy.js";

function textChannel(id, name, { bot = true, requester = true, sendable = true } = {}) {
  return {
    id,
    name,
    isTextBased: () => true,
    send: sendable ? async () => ({ id: "message" }) : undefined,
    permissionsFor: (member) => ({ has: (permission) => {
      if (permission === "ViewChannel") return member.id === "bot" ? bot : requester;
      if (permission === "SendMessages" || permission === "EmbedLinks") return member.id === "bot";
      return false;
    } }),
  };
}

test("configured accessible request channel is preferred", () => {
  const configured = textChannel("text-a", "staff-requests");
  const named = textChannel("text-b", "demandes-vocales");
  const guild = { channels: { cache: new Map([[configured.id, configured], [named.id, named]]) } };
  const result = chooseVoiceRequestDestination({
    guild, voiceChannel: { id: "voice-a" }, requester: { id: "member" }, bot: { id: "bot" }, configuredChannelId: "text-a",
  });
  assert.equal(result, configured);
});

test("named request channel is used when no configured channel is available", () => {
  const named = textChannel("text-b", "demandes-vocales");
  const guild = { channels: { cache: new Map([[named.id, named]]) } };
  assert.equal(chooseVoiceRequestDestination({ guild, voiceChannel: { id: "voice-a" }, requester: { id: "member" }, bot: { id: "bot" } }), named);
});

test("inaccessible or non-sendable channels are rejected", () => {
  const hidden = textChannel("text-c", "demandes-vocales", { requester: false });
  const notSendable = textChannel("text-d", "demandes-vocales", { sendable: false });
  const guild = { channels: { cache: new Map([[hidden.id, hidden], [notSendable.id, notSendable]]) } };
  assert.equal(chooseVoiceRequestDestination({ guild, voiceChannel: { id: "voice-a" }, requester: { id: "member" }, bot: { id: "bot" } }), null);
});

test("standard voice channel is never selected as a message destination", () => {
  const voiceChannel = { id: "voice-a", isTextBased: () => false, send: async () => {} };
  const guild = { channels: { cache: new Map([[voiceChannel.id, voiceChannel]]) } };
  assert.equal(chooseVoiceRequestDestination({ guild, voiceChannel, requester: { id: "member" }, bot: { id: "bot" }, configuredChannelId: "voice-a" }), null);
});


test("voice entry-point buttons only work in their own channel and on the bot's message", () => {
  const base = {
    customId: "vreq:start:222222",
    channelId: "222222",
    messageChannelId: "222222",
    messageAuthorId: "bot",
    botUserId: "bot",
  };
  assert.equal(isVoiceAccessEntryPointContext(base), true);
  assert.equal(isVoiceAccessEntryPointContext({ ...base, channelId: "333333" }), false);
  assert.equal(isVoiceAccessEntryPointContext({ ...base, messageChannelId: "333333" }), false);
  assert.equal(isVoiceAccessEntryPointContext({ ...base, messageAuthorId: "member" }), false);
  assert.equal(isVoiceAccessEntryPointContext({ ...base, customId: "vreq:start:not-a-snowflake" }), false);
});
