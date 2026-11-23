import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databasePath = `/tmp/pnd-voice-lock-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const store = await import("./voice-lock-store.js");
const voice = await import("./voice-commands.js");
const { db } = await import("./database.js");

const guildId = "300000000000000001";
const channelId = "300000000000000002";
const ownerId = "300000000000000003";
const CONNECT = (1n << 20n).toString();

after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});
beforeEach(() => {
  db.prepare("DELETE FROM voice_lock_snapshots").run();
});

const original = [
  { id: guildId, type: 0, allow: "0", deny: "0" },
  { id: "role-x", type: 0, allow: CONNECT, deny: "0" },
];

test("first snapshot wins and survives a reload", () => {
  assert.equal(
    store.saveVoiceLockSnapshotIfAbsent({
      guildId,
      channelId,
      ownerId,
      overwrites: original,
    }),
    true,
  );
  assert.equal(
    store.saveVoiceLockSnapshotIfAbsent({
      guildId,
      channelId,
      ownerId,
      overwrites: [],
    }),
    false,
  );
  const snapshot = store.getVoiceLockSnapshot(channelId);
  assert.deepEqual(snapshot.overwrites, original);
  assert.equal(snapshot.ownerId, ownerId);
  assert.equal(store.listVoiceLockSnapshots(guildId).length, 1);
  assert.equal(store.listVoiceLockSnapshots("other").length, 0);
});

test("invalid snapshots are refused", () => {
  assert.throws(() =>
    store.saveVoiceLockSnapshotIfAbsent({
      guildId,
      channelId,
      overwrites: [{ id: 1 }],
    }),
  );
});

test("legacy JSON is imported once and kept as a renamed backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "pv-legacy-"));
  const file = join(dir, "voice-locks.json");
  writeFileSync(
    file,
    JSON.stringify({
      [channelId]: { guildId, overwrites: original, createdAt: 5 },
      bad: { guildId },
    }),
  );
  assert.deepEqual(store.importLegacyVoiceLocks(file), {
    imported: 1,
    skipped: 1,
  });
  assert.equal(existsSync(file), false);
  assert.ok(
    readdirSync(dir).some((name) =>
      name.startsWith("voice-locks.json.imported-"),
    ),
  );
  assert.equal(store.getVoiceLockSnapshot(channelId).createdAt, 5);
  rmSync(dir, { recursive: true, force: true });
});

test("lock state detection reads the @everyone Connect deny", () => {
  assert.equal(
    store.isChannelStillLocked(
      [{ id: guildId, allow: "0", deny: CONNECT }],
      guildId,
    ),
    true,
  );
  assert.equal(
    store.isChannelStillLocked(
      [{ id: guildId, allow: "0", deny: "0" }],
      guildId,
    ),
    false,
  );
  assert.equal(store.isChannelStillLocked([], guildId), false);
});

function overwrite(id, type, allow, deny) {
  return {
    id,
    type,
    allow: { bitfield: BigInt(allow) },
    deny: { bitfield: BigInt(deny) },
  };
}

function makeClient({ channel }) {
  const edits = [];
  const guild = {
    id: guildId,
    roles: { everyone: { id: guildId } },
    channels: {
      cache: new Map(channel ? [[channelId, channel]] : []),
      fetch: async () => {
        const e = new Error("Unknown Channel");
        e.code = 10003;
        throw e;
      },
    },
  };
  if (channel)
    channel.permissionOverwrites.edit = async (target, perms) => {
      edits.push([target.id, perms]);
    };
  return { client: { guilds: { cache: new Map([[guildId, guild]]) } }, edits };
}

test("reconcile drops snapshots of deleted channels", async () => {
  store.saveVoiceLockSnapshotIfAbsent({
    guildId,
    channelId,
    overwrites: original,
  });
  const { client } = makeClient({ channel: null });
  const result = await voice.reconcilePrivateVoiceLocks(client);
  assert.equal(result.deleted, 1);
  assert.equal(store.getVoiceLockSnapshot(channelId), null);
});

test("reconcile re-applies the private deny when it drifted while offline", async () => {
  store.saveVoiceLockSnapshotIfAbsent({
    guildId,
    channelId,
    overwrites: original,
  });
  const channel = {
    id: channelId,
    permissionOverwrites: {
      cache: new Map([[guildId, overwrite(guildId, 0, 0, 0)]]),
    },
  };
  const { client, edits } = makeClient({ channel });
  const result = await voice.reconcilePrivateVoiceLocks(client);
  assert.equal(result.relocked, 1);
  assert.deepEqual(edits, [[guildId, { Connect: false }]]);
  assert.ok(
    store.getVoiceLockSnapshot(channelId),
    "original snapshot is kept for UNPV",
  );
});

test("reconcile leaves a still-private channel and unknown guilds untouched", async () => {
  store.saveVoiceLockSnapshotIfAbsent({
    guildId,
    channelId,
    overwrites: original,
  });
  store.saveVoiceLockSnapshotIfAbsent({
    guildId: "999990000000000001",
    channelId: "999990000000000002",
    overwrites: original,
  });
  const channel = {
    id: channelId,
    permissionOverwrites: {
      cache: new Map([[guildId, overwrite(guildId, 0, 0, CONNECT)]]),
    },
  };
  const { client, edits } = makeClient({ channel });
  const result = await voice.reconcilePrivateVoiceLocks(client);
  assert.deepEqual(result, { deleted: 0, relocked: 0, kept: 1 });
  assert.equal(edits.length, 0);
  assert.ok(store.getVoiceLockSnapshot("999990000000000002"));
});

test("UNPV restores the original overwrites from SQLite and clears the snapshot", async () => {
  store.saveVoiceLockSnapshotIfAbsent({
    guildId,
    channelId,
    overwrites: original,
  });
  const edits = [];
  const roles = new Map([
    [guildId, { id: guildId }],
    ["role-x", { id: "role-x" }],
  ]);
  const members = new Map([[ownerId, { id: ownerId }]]);
  const channel = {
    id: channelId,
    guild: {
      id: guildId,
      roles: { cache: roles, fetch: async () => null },
      members: { cache: members, fetch: async () => null },
    },
    permissionOverwrites: {
      cache: new Map([
        [guildId, overwrite(guildId, 0, 0, CONNECT)],
        ["role-x", overwrite("role-x", 0, 0, CONNECT)],
        [ownerId, overwrite(ownerId, 1, CONNECT, 0)],
      ]),
      edit: async (target, perms) => {
        edits.push([target.id, perms.Connect]);
      },
    },
  };
  await voice.unlockPrivateVoiceChannel(channel);
  assert.deepEqual(
    new Map(edits),
    new Map([
      [guildId, null],
      ["role-x", true],
      [ownerId, null],
    ]),
  );
  assert.equal(store.getVoiceLockSnapshot(channelId), null);
});

test("channel deletion forgets the PV snapshot", () => {
  store.saveVoiceLockSnapshotIfAbsent({
    guildId,
    channelId,
    overwrites: original,
  });
  voice.forgetVoicePanels(channelId);
  assert.equal(store.getVoiceLockSnapshot(channelId), null);
});

test("=unpv restores the original overwrites through the prefix command (same rights as =pv)", async () => {
  const { canUseVoiceCommand, voiceCommand } = await import("./voice-permissions.js");
  assert.equal(voiceCommand("=unpv"), "=unpv");
  assert.equal(canUseVoiceCommand("=unpv", 0n, ["sys"], null, false, null, "sys"), true);
  assert.equal(canUseVoiceCommand("=unpv", 0n, [], [], false, null, null), false);

  store.saveVoiceLockSnapshotIfAbsent({ guildId, channelId, overwrites: original });
  const edits = [];
  const roles = new Map([[guildId, { id: guildId }], ["role-x", { id: "role-x" }]]);
  const channel = {
    id: channelId, name: "Salon", type: 2,
    permissionsFor: () => ({ bitfield: 0n, has: () => true }),
    permissionOverwrites: {
      cache: new Map([[guildId, overwrite(guildId, 0, 0, CONNECT)], ["role-x", overwrite("role-x", 0, 0, CONNECT)]]),
      edit: async (target, perms) => { edits.push([target.id, perms.Connect]); },
    },
  };
  const member = { id: ownerId, voice: { channelId }, roles: { cache: new Map([["sys", {}]]) }, guild: { id: guildId } };
  const guild = {
    id: guildId, ownerId: "300000000000000099",
    roles: { cache: roles, fetch: async () => null },
    members: { cache: new Map(), fetch: async () => member, fetchMe: async () => ({ id: "bot", permissions: { has: () => true } }) },
    channels: { fetch: async () => channel },
  };
  channel.guild = guild;
  const replies = [];
  const handled = await voice.handleVoiceMessage({ content: "=unpv", guild, member, author: { id: ownerId }, mentions: { members: { first: () => null } }, reply: async (p) => { replies.push(p); } }, { sysPlus: { roleId: "sys" }, voiceAccess: null });
  assert.equal(handled, true);
  assert.match(JSON.stringify(replies), /de nouveau accessible/);
  assert.deepEqual(new Map(edits), new Map([[guildId, null], ["role-x", true]]));
  assert.equal(store.getVoiceLockSnapshot(channelId), null);
});
