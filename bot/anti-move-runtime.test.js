import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-anti-move-runtime-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const store = await import("./anti-move.js");
const { db } = await import("./database.js");
const { AuditLogEvent } = await import("discord.js");

const guildId = "200000000000000001";
const protectedId = "200000000000000002";
const moverId = "200000000000000003";
const botId = "200000000000000004";
const otherMoverId = "200000000000000005";

after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

function makeGuild() {
  const audit = {
    [AuditLogEvent.MemberMove]: [],
    [AuditLogEvent.MemberDisconnect]: [],
  };
  const moves = [];
  const member = {
    id: protectedId,
    user: { bot: false },
    voice: {
      channelId: "voice-b",
      setChannel: async (channelId) => {
        moves.push(channelId);
        member.voice.channelId = channelId;
      },
    },
  };
  const guild = {
    id: guildId,
    audit,
    moves,
    member,
    channels: {
      cache: new Map([
        ["voice-a", { id: "voice-a" }],
        ["voice-b", { id: "voice-b" }],
      ]),
      fetch: async () => null,
    },
    members: {
      me: { id: botId, permissions: { has: () => true } },
      fetch: async () => member,
      fetchMe: async () => guild.members.me,
    },
    fetchAuditLogs: async ({ type }) => ({
      entries: new Map(audit[type].map((entry) => [entry.id, entry])),
    }),
  };
  return guild;
}

function states(guild, from, to) {
  guild.member.voice.channelId = to;
  return [
    {
      id: protectedId,
      guild,
      member: guild.member,
      channelId: from,
      channel: from ? { id: from } : null,
    },
    {
      id: protectedId,
      guild,
      member: guild.member,
      channelId: to,
      channel: to ? { id: to } : null,
    },
  ];
}

// Real Discord MEMBER_MOVE entries: executor + destination + count, no target.
const moveEntry = (
  id,
  executorId,
  channelId,
  count,
  createdTimestamp = Date.now(),
) => ({
  id,
  executor: { id: executorId },
  target: null,
  createdTimestamp,
  extra: { channel: { id: channelId }, count },
});

beforeEach(() => {
  store.resetAntiMoveRuntimeState();
  db.prepare("DELETE FROM anti_move_protected_members").run();
  db.prepare("DELETE FROM anti_move_exemptions").run();
  store.setAntiMoveEnabled(guildId, true, moverId);
  store.protectAntiMoveMember(guildId, protectedId, moverId);
});

test("restores a protected member from a real target-less MEMBER_MOVE entry", async () => {
  const guild = makeGuild();
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 1),
  );
  assert.equal(
    await store.handleAntiMoveVoiceState(
      ...states(guild, "voice-a", "voice-b"),
    ),
    true,
  );
  assert.deepEqual(guild.moves, ["voice-a"]);
});

test("detects an aggregated entry whose count increased since the snapshot", async () => {
  const guild = makeGuild();
  const old = Date.now() - 120_000;
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 2, old),
  );
  await store.primeAntiMoveAuditSnapshots({
    guilds: { cache: new Map([[guildId, guild]]) },
  });
  guild.audit[AuditLogEvent.MemberMove][0] = moveEntry(
    "e1",
    moverId,
    "voice-b",
    3,
    old,
  );
  assert.equal(
    await store.handleAntiMoveVoiceState(
      ...states(guild, "voice-a", "voice-b"),
    ),
    true,
  );
  assert.deepEqual(guild.moves, ["voice-a"]);
});

test("an unchanged old aggregated entry is never treated as fresh (voluntary move)", async () => {
  const guild = makeGuild();
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 4, Date.now() - 120_000),
  );
  await store.primeAntiMoveAuditSnapshots({
    guilds: { cache: new Map([[guildId, guild]]) },
  });
  assert.equal(
    await store.handleAntiMoveVoiceState(
      ...states(guild, "voice-a", "voice-b"),
    ),
    false,
  );
  assert.deepEqual(guild.moves, []);
});

test("two distinct executors moving into the destination is ambiguous and fails closed", async () => {
  const guild = makeGuild();
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 1),
    moveEntry("e2", otherMoverId, "voice-b", 1),
  );
  assert.equal(
    await store.handleAntiMoveVoiceState(
      ...states(guild, "voice-a", "voice-b"),
    ),
    false,
  );
  assert.deepEqual(guild.moves, []);
});

test("forced disconnects are logged but never trigger a move attempt", async () => {
  const guild = makeGuild();
  guild.audit[AuditLogEvent.MemberDisconnect].push({
    id: "d1",
    executor: { id: moverId },
    createdTimestamp: Date.now(),
    extra: { count: 1 },
  });
  assert.equal(
    await store.handleAntiMoveVoiceState(...states(guild, "voice-a", null)),
    false,
  );
  assert.deepEqual(guild.moves, []);
  const row = db
    .prepare(
      "SELECT action FROM sysplus_audit WHERE action='anti_move.disconnect_detected'",
    )
    .get();
  assert.ok(row);
});

test("exempted actors are ignored", async () => {
  const guild = makeGuild();
  store.addAntiMoveExemption(guildId, moverId, moverId);
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 1),
  );
  assert.equal(
    await store.handleAntiMoveVoiceState(
      ...states(guild, "voice-a", "voice-b"),
    ),
    false,
  );
});

test("ping-pong is stopped after three restores in a minute", async () => {
  const guild = makeGuild();
  let restored = 0;
  for (let i = 1; i <= 4; i += 1) {
    guild.audit[AuditLogEvent.MemberMove] = [
      moveEntry("e1", moverId, "voice-b", i, Date.now()),
    ];
    if (
      await store.handleAntiMoveVoiceState(
        ...states(guild, "voice-a", "voice-b"),
      )
    )
      restored += 1;
  }
  assert.equal(restored, 3);
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM sysplus_audit WHERE action='anti_move.loop_stopped'",
      )
      .get(),
  );
});

test("no restore when the member already left the destination", async () => {
  const guild = makeGuild();
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 1),
  );
  const [oldState, newState] = states(guild, "voice-a", "voice-b");
  guild.member.voice.channelId = "voice-c";
  assert.equal(await store.handleAntiMoveVoiceState(oldState, newState), false);
  assert.deepEqual(guild.moves, []);
});

test("a Discord refusal is contained and reported as not restored", async () => {
  const guild = makeGuild();
  guild.member.voice.setChannel = async () => {
    throw new Error("Missing Permissions");
  };
  guild.audit[AuditLogEvent.MemberMove].push(
    moveEntry("e1", moverId, "voice-b", 1),
  );
  assert.equal(
    await store.handleAntiMoveVoiceState(
      ...states(guild, "voice-a", "voice-b"),
    ),
    false,
  );
});
