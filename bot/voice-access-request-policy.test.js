import test from "node:test";
import assert from "node:assert/strict";
import {
  canRequestFromVoiceChat,
  isDiscordSnowflake,
  isVoiceAccessRequestExpired,
  matchesVoiceAccessRequestMessage,
  parseVoiceChannelId,
  VOICE_ACCESS_REQUEST_TTL,
  voiceAccessGrantPermissions,
} from "./voice-access-request-policy.js";

const CHANNEL_ID = "12345678901234567";
const REQUIRED = (1n << 10n) | (1n << 11n) | (1n << 16n);

test("voice channel references accept IDs, mentions and Discord channel links", () => {
  assert.equal(parseVoiceChannelId(CHANNEL_ID), CHANNEL_ID);
  assert.equal(parseVoiceChannelId(`<#${CHANNEL_ID}>`), CHANNEL_ID);
  assert.equal(parseVoiceChannelId(`https://discord.com/channels/23456789012345678/${CHANNEL_ID}`), CHANNEL_ID);
  assert.equal(parseVoiceChannelId("not-a-channel"), null);
  assert.equal(parseVoiceChannelId("<@12345678901234567>"), null);
});

test("snowflake validation rejects non-string and malformed values", () => {
  assert.equal(isDiscordSnowflake(CHANNEL_ID), true);
  assert.equal(isDiscordSnowflake("12"), false);
  assert.equal(isDiscordSnowflake(12345678901234567), false);
});

test("voice-chat requests require view, send and read-history permissions", () => {
  assert.equal(canRequestFromVoiceChat(REQUIRED), true);
  assert.equal(canRequestFromVoiceChat(REQUIRED & ~(1n << 20n)), true, "CONNECT is deliberately not required");
  assert.equal(canRequestFromVoiceChat(REQUIRED & ~(1n << 11n)), false);
  assert.equal(canRequestFromVoiceChat("invalid"), false);
});

test("requests expire after 24 hours", () => {
  const now = 2_000_000;
  assert.equal(isVoiceAccessRequestExpired(now - VOICE_ACCESS_REQUEST_TTL - 1, now), true);
  assert.equal(isVoiceAccessRequestExpired(now - VOICE_ACCESS_REQUEST_TTL, now), false);
  assert.equal(isVoiceAccessRequestExpired(now, now), false);
  assert.equal(isVoiceAccessRequestExpired(Number.NaN, now), true);
});


test("approval grants only private-channel visibility and voice connection", () => {
  assert.deepEqual(voiceAccessGrantPermissions(), {
    ViewChannel: true,
    Connect: true,
  });
});


test("approval buttons must match the persisted request message", () => {
  assert.equal(matchesVoiceAccessRequestMessage("12345678901234567", "12345678901234567"), true);
  assert.equal(matchesVoiceAccessRequestMessage("12345678901234567", "12345678901234568"), false);
  assert.equal(matchesVoiceAccessRequestMessage(null, "12345678901234567"), false);
  assert.equal(matchesVoiceAccessRequestMessage("invalid", "12345678901234567"), false);
});
