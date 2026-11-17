import test from "node:test";
import assert from "node:assert/strict";
import { ANTI_MOVE_AUDIT_LOOKBACK_MS, findUniqueAntiMoveEntry, isSuppressedAntiMoveReturn } from "./anti-move-policy.js";

const auditEntry = (id, executorId, channelId, count, createdTimestamp) => ({
  id, executorId, createdTimestamp, executor: { id: executorId, bot: false },
  extra: { channel: { id: channelId }, count },
});

test("anti-move correlates only one recent single-member move entry", () => {
  const now = 20_000;
  const entry = auditEntry("entry-1", "moderator-1", "voice-2", 1, 19_000);
  assert.equal(findUniqueAntiMoveEntry([entry], { destinationChannelId: "voice-2", actorId: "member-1", eventAt: 19_000, now }), entry);
  assert.ok(ANTI_MOVE_AUDIT_LOOKBACK_MS >= 4_000);
});

test("anti-move ignores bulk moves, self moves, stale entries and ambiguous candidates", () => {
  const now = 20_000;
  const recent = auditEntry("one", "mod-1", "voice-2", 1, 19_000);
  const another = auditEntry("two", "mod-2", "voice-2", 1, 19_100);
  const bulk = auditEntry("bulk", "mod-1", "voice-2", 2, 19_000);
  const self = auditEntry("self", "member-1", "voice-2", 1, 19_000);
  const stale = auditEntry("old", "mod-1", "voice-2", 1, 10_000);
  const opts = { destinationChannelId: "voice-2", actorId: "member-1", eventAt: 19_000, now };
  assert.equal(findUniqueAntiMoveEntry([bulk], opts), null);
  assert.equal(findUniqueAntiMoveEntry([self], opts), null);
  assert.equal(findUniqueAntiMoveEntry([stale], opts), null);
  assert.equal(findUniqueAntiMoveEntry([recent, another], opts), null);
});

test("anti-move suppresses exactly the bot's return event", () => {
  const map = new Map([["guild:member:voice-home", 15_000]]);
  assert.equal(isSuppressedAntiMoveReturn(map, "guild", "member", "voice-home", 14_000), true);
  assert.equal(isSuppressedAntiMoveReturn(map, "guild", "member", "voice-home", 14_001), false);
  assert.equal(map.has("guild:member:voice-home"), false);
});
