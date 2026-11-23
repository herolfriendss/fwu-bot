import test from "node:test";
import assert from "node:assert/strict";
import { isVoiceRelocation, matchVoiceAuditEntries } from "./anti-move-policy.js";

const guild = { id: "100000000000000001" };
const member = { id: "100000000000000002", user: { bot: false } };

function states(from, to) {
  return [
    { id: member.id, guild, member, channelId: from, channel: from ? { id: from } : null },
    { id: member.id, guild, member, channelId: to, channel: to ? { id: to } : null },
  ];
}

test("anti-move candidate detects a channel transfer or forced disconnect, not a join", () => {
  assert.equal(isVoiceRelocation(...states("voice-a", "voice-b")), true);
  assert.equal(isVoiceRelocation(...states("voice-a", null)), true);
  assert.equal(isVoiceRelocation(...states(null, "voice-a")), false);
  assert.equal(isVoiceRelocation(...states("voice-a", "voice-a")), false);
});

test("anti-move ignores bot members and cross-server state pairs", () => {
  const [oldState, newState] = states("voice-a", "voice-b");
  newState.member = { user: { bot: true } };
  assert.equal(isVoiceRelocation(oldState, newState), false);

  const otherGuildState = { ...newState, guild: { id: "100000000000000009" } };
  assert.equal(isVoiceRelocation(oldState, otherGuildState), false);
});

test("audit matching requires target, actor, freshness and exact destination", () => {
  const entries = [{
    target: { id: member.id },
    executor: { id: "100000000000000003" },
    createdTimestamp: 9_900,
    extra: { channel: { id: "voice-b" } },
  }];
  assert.deepEqual(matchVoiceAuditEntries(entries, {
    targetId: member.id, botId: "100000000000000004", destinationChannelId: "voice-b", now: 10_000,
  }), { actorId: "100000000000000003", action: "déplacement forcé" });
  assert.equal(matchVoiceAuditEntries(entries, {
    targetId: member.id, botId: "100000000000000004", destinationChannelId: "voice-c", now: 10_000,
  }), null);
  assert.equal(matchVoiceAuditEntries(entries, {
    targetId: member.id, botId: "100000000000000004", destinationChannelId: "voice-b", now: 20_000,
  }), null);
});

test("audit matching fails closed for self-moves, bot actors and ambiguous entries", () => {
  const base = {
    target: { id: member.id },
    executor: { id: "100000000000000003" },
    createdTimestamp: 9_900,
    extra: { channel: { id: "voice-b" } },
  };
  const options = { targetId: member.id, botId: "100000000000000004", destinationChannelId: "voice-b", now: 10_000 };
  assert.equal(matchVoiceAuditEntries([{ ...base, executor: { id: member.id } }], options), null);
  assert.equal(matchVoiceAuditEntries([{ ...base, executor: { id: options.botId } }], options), null);
  assert.equal(matchVoiceAuditEntries([base, { ...base, executor: { id: "100000000000000005" } }], options), null);
});

test("real MEMBER_MOVE entries without target are matched by executor and destination", () => {
  const entry = { id: "1", executor: { id: "100000000000000003" }, target: null, createdTimestamp: 9_900, extra: { channel: { id: "voice-b" }, count: 1 } };
  assert.deepEqual(matchVoiceAuditEntries([entry], { targetId: member.id, botId: "b", destinationChannelId: "voice-b", now: 10_000 }), { actorId: "100000000000000003", action: "déplacement forcé" });
  // An explicit different target is never accepted.
  assert.equal(matchVoiceAuditEntries([{ ...entry, target: { id: "someone-else" } }], { targetId: member.id, botId: "b", destinationChannelId: "voice-b", now: 10_000 }), null);
});

test("aggregated entries require a count increase over the snapshot", async () => {
  const { snapshotAuditCounts } = await import("./anti-move-policy.js");
  const entry = { id: "1", executor: { id: "x" }, createdTimestamp: 0, extra: { channel: { id: "voice-b" }, count: 3 } };
  const options = { targetId: member.id, botId: "b", destinationChannelId: "voice-b", now: 600_000 };
  assert.equal(matchVoiceAuditEntries([entry], { ...options, previousCounts: snapshotAuditCounts([entry]) }), null);
  assert.equal(matchVoiceAuditEntries([entry], { ...options, previousCounts: new Map([["1", 2]]) })?.actorId, "x");
  // Without snapshot, a stale entry is ignored.
  assert.equal(matchVoiceAuditEntries([entry], options), null);
});

test("restore budget stops ping-pong", async () => {
  const { restoreBudget } = await import("./anti-move-policy.js");
  let stamps = [];
  for (let i = 0; i < 3; i += 1) { const r = restoreBudget(stamps, { now: 1000 + i }); assert.equal(r.allowed, true); stamps = r.timestamps; }
  assert.equal(restoreBudget(stamps, { now: 1010 }).allowed, false);
  assert.equal(restoreBudget(stamps, { now: 70_000 }).allowed, true);
});
