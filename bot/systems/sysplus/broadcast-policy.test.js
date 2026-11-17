import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { DM_CAMPAIGN_MAX_RECIPIENTS, DM_CAMPAIGN_DELAY_MS, WAKEUP_HOP_DELAY_MS, WAKEUP_MAX_CHANNELS, isDmAllOwner, isEligibleWakeupChannel, parseDmAllOwnerIds } from "./broadcast-policy.js";

function permissions(values = []) { return { has: (flag) => values.includes(flag) }; }
function channel({ id = "channel", type = ChannelType.GuildVoice, everyone = true, target = true, botConnect = true, botMove = true } = {}) {
  const access = new Map([["everyone", permissions(everyone ? [PermissionFlagsBits.Connect] : [])], ["target", permissions(target ? [PermissionFlagsBits.Connect] : [])], ["bot", permissions([...(botConnect ? [PermissionFlagsBits.Connect] : []), ...(botMove ? [PermissionFlagsBits.MoveMembers] : [])])]]);
  return { id, type, guildId: "guild", permissionsFor(member) { return access.get(member.id); } };
}

test("DM-all owner allowlist accepts exact numeric IDs only", () => {
  assert.deepEqual([...parseDmAllOwnerIds("123456789012345678, 234567890123456789;invalid")], ["123456789012345678", "234567890123456789"]);
  assert.equal(isDmAllOwner("123456789012345678", "123456789012345678,234567890123456789"), true);
  assert.equal(isDmAllOwner("12345678901234567", "123456789012345678"), false);
  assert.equal(isDmAllOwner("999999999999999999", ""), false);
});
test("wake-up and DM jobs are bounded and deliberately rate-limited", () => {
  assert.equal(WAKEUP_MAX_CHANNELS, 8); assert.ok(WAKEUP_HOP_DELAY_MS >= 2000); assert.ok(DM_CAMPAIGN_DELAY_MS >= 2000); assert.equal(DM_CAMPAIGN_MAX_RECIPIENTS, 500);
});
test("only public ordinary voice channels with permissions are eligible", () => {
  const target = { id: "target" }, bot = { id: "bot" }, everyone = { id: "everyone" };
  const options = { guildId: "guild", everyoneRole: everyone, tempChannelIds: new Set(), targetMember: target, botMember: bot };
  assert.equal(isEligibleWakeupChannel(channel(), options), true);
  assert.equal(isEligibleWakeupChannel(channel({ everyone: false }), options), false);
  assert.equal(isEligibleWakeupChannel(channel({ id: "temp" }), { ...options, tempChannelIds: new Set(["temp"]) }), false);
  assert.equal(isEligibleWakeupChannel(channel({ type: ChannelType.GuildStageVoice }), options), false);
  assert.equal(isEligibleWakeupChannel(channel({ botMove: false }), options), false);
  assert.equal(isEligibleWakeupChannel(channel({ target: false }), options), false);
});