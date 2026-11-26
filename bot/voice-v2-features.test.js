// FWU V2 — tâche 6 : vocal de masse, vocal privé qui se réinitialise, accessall réversible.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType, PermissionFlagsBits as P } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "fwu-voice-v2-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const env = { PND_OWNER_DISCORD_ID: "900000000000000009" };
const A = "710000000000000001";
const B = "710000000000000002";

const mass = await import("./voice-mass.js");
const reset = await import("./voice-private-reset.js");
const store = await import("./voice-lock-store.js");
const move = await import("./voice-move.js");
const { db } = await import("./database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

function world() {
  const channels = new Map();
  const members = new Map();
  const guild = { id: "100000000000000001", ownerId: "100000000000000002", channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null }, members: { cache: members, fetch: async (arg) => members.get(typeof arg === "string" ? arg : arg.user) ?? null }, voiceStates: { cache: new Map() } };
  const channel = (id) => {
    const c = { id, name: `Salon ${id}`, type: ChannelType.GuildVoice, guild, members: new Map() };
    channels.set(id, c);
    return c;
  };
  const member = (id, position, channelId = null, { perms = [], roles = [] } = {}) => {
    const m = {
      id, guild, user: { id, bot: false },
      roles: { highest: { position }, cache: new Set(roles) },
      permissions: { has: (bit) => perms.includes(bit) },
      voice: {
        serverMute: false,
        get channelId() { return m._ch; },
        get channel() { return m._ch ? channels.get(m._ch) : null; },
        async setChannel(target) { const id2 = typeof target === "string" ? target : target.id; channels.get(m._ch)?.members.delete(m.id); m._ch = id2; channels.get(id2)?.members.set(m.id, m); },
        async setMute(value) { m.voice.serverMute = value; },
        async disconnect() { channels.get(m._ch)?.members.delete(m.id); m._ch = null; },
      },
      _ch: null,
    };
    m.roles.cache.has = (r) => roles.includes(r);
    members.set(id, m);
    if (channelId) { m._ch = channelId; channels.get(channelId).members.set(id, m); guild.voiceStates.cache.set(id, { member: m }); }
    return m;
  };
  return { guild, channel, member };
}

test("mvall: preview counts eligible members, skips higher and Anti-Move protected ones, then undo puts them back", async () => {
  const w = world();
  w.channel(A); w.channel(B);
  const actor = w.member("200000000000000001", 10, A, { perms: [P.MoveMembers] });
  w.member("300000000000000001", 1, A);
  w.member("300000000000000002", 2, A);
  w.member("300000000000000003", 50, A); // au-dessus
  w.member("300000000000000004", 1, A); // protégé
  const protectedCheck = (guildId, id) => id === "300000000000000004";
  const { plan } = mass.planMassAction(w.guild, actor, { kind: "mvall", source: A, target: B }, { env, protectedCheck });
  assert.equal(plan.members.length, 2);
  assert.deepEqual(plan.skipped, { higher: 1, protected: 1, bots: 0 });
  const preview = mass.previewPayload(w.guild, actor, plan);
  assert.match(preview.content, /2\*\* membre/);
  assert.match(preview.components[0].components[0].custom_id, /^vmass:confirm:/);
  const result = await mass.executeMassPlan(w.guild, actor, plan, { stepMs: 0 });
  assert.equal(result.done, 2);
  assert.equal(w.guild.members.cache.get("300000000000000001").voice.channelId, B);
  const undo = await mass.undoLastMass(w.guild, actor, { env, stepMs: 0 });
  assert.match(undo, /2 membre/);
  assert.equal(w.guild.members.cache.get("300000000000000001").voice.channelId, A);
});

test("mass actions need the right Discord permission; the preview button is bound to its author", async () => {
  const w = world();
  w.channel(A); w.channel(B);
  const nobody = w.member("200000000000000002", 10, A);
  assert.match(mass.planMassAction(w.guild, nobody, { kind: "mvall", source: A, target: B }, { env }).error, /permission/);
  const actor = w.member("200000000000000003", 10, A, { perms: [P.MoveMembers] });
  w.member("300000000000000009", 1, A);
  const { plan } = mass.planMassAction(w.guild, actor, { kind: "mvall", source: A, target: B }, { env, protectedCheck: () => false });
  const id = mass.previewPayload(w.guild, actor, plan).components[0].components[0].custom_id;
  const replies = [];
  await mass.handleMassButton({ customId: id, user: { id: "someone-else" }, isButton: () => true, reply: async (p) => replies.push(p) }, { env });
  assert.match(replies[0].content, /pas pour toi/);
});

test("muteall then undo restores the previous mute state; swap exchanges channels", async () => {
  const w = world();
  w.channel(A); w.channel(B);
  const actor = w.member("200000000000000004", 10, A, { perms: [P.MuteMembers, P.MoveMembers] });
  const x = w.member("300000000000000011", 1, A);
  const { plan } = mass.planMassAction(w.guild, actor, { kind: "muteall", source: A }, { env, protectedCheck: () => false });
  await mass.executeMassPlan(w.guild, actor, plan, { stepMs: 0 });
  assert.equal(x.voice.serverMute, true);
  await mass.undoLastMass(w.guild, actor, { env, stepMs: 0 });
  assert.equal(x.voice.serverMute, false);
  const y = w.member("300000000000000012", 1, B);
  assert.match(await mass.swapMembers(w.guild, actor, x.id, y.id, { env, protectedCheck: () => false }), /échangé/);
  assert.equal(x.voice.channelId, B);
  assert.equal(y.voice.channelId, A);
});

test("private voice: the owner leaves → permissions restored after the grace period; coming back cancels it", async () => {
  const w = world();
  const room = w.channel("700000000000000001");
  store.saveVoiceLockSnapshotIfAbsent({ guildId: w.guild.id, channelId: room.id, ownerId: "300000000000000020", overwrites: [] });
  const unlocked = [];
  const unlock = async (channel) => { unlocked.push(channel.id); store.deleteVoiceLockSnapshot(channel.id); };
  const timers = [];
  const schedule = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; };
  const leave = { guild: w.guild, id: "300000000000000020", channelId: room.id };
  const gone = { guild: w.guild, id: "300000000000000020", channelId: null };
  reset.handlePrivateVoiceOwnerState(leave, gone, { unlock, schedule });
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 30_000 && timers[0].ms <= 60_000);
  await timers[0].fn();
  assert.deepEqual(unlocked, [room.id], "owner absent → restored");

  // Simple coupure : le propriétaire revient avant la fin du délai.
  store.saveVoiceLockSnapshotIfAbsent({ guildId: w.guild.id, channelId: room.id, ownerId: "300000000000000020", overwrites: [] });
  const owner = w.member("300000000000000020", 1);
  reset.handlePrivateVoiceOwnerState(leave, gone, { unlock, schedule });
  await owner.voice.setChannel(room);
  reset.handlePrivateVoiceOwnerState(gone, { guild: w.guild, id: owner.id, channelId: room.id }, { unlock, schedule });
  await timers.at(-1).fn();
  assert.equal(unlocked.length, 1, "owner back in the channel → nothing restored");
  assert.equal(reset.shouldResetPrivate({ snapshot: { ownerId: "x" }, ownerPresent: false, temporary: true }), false, "Join-to-Create untouched");
});

test("startup: no abandoned private voice stays locked", async () => {
  const w = world();
  const room = w.channel("700000000000000002");
  store.saveVoiceLockSnapshotIfAbsent({ guildId: w.guild.id, channelId: room.id, ownerId: "300000000000000030", overwrites: [] });
  const unlocked = [];
  const client = { guilds: { cache: new Map([[w.guild.id, w.guild]]) } };
  const count = await reset.resetAbandonedPrivateVoices(client, { unlock: async (c) => { unlocked.push(c.id); store.deleteVoiceLockSnapshot(c.id); } });
  assert.ok(count >= 1);
  assert.ok(unlocked.includes(room.id));
});

test("accessall keeps the first snapshot and restores exactly the previous overwrites", async () => {
  const sets = [];
  const overwrites = new Map([["100000000000000001", { id: "100000000000000001", type: 0, allow: { bitfield: 0n }, deny: { bitfield: P.Connect } }]]);
  const channel = { id: "700000000000000003", guild: { id: "100000000000000001" }, permissionOverwrites: { cache: overwrites, set: async (list) => sets.push(list) } };
  move.saveAccessAllSnapshot(channel, "actor");
  overwrites.set("100000000000000001", { id: "100000000000000001", type: 0, allow: { bitfield: P.Connect }, deny: { bitfield: 0n } });
  move.saveAccessAllSnapshot(channel, "actor"); // la première photo gagne
  assert.equal(await move.restoreAccessAll(channel), true);
  assert.equal(sets[0][0].deny, P.Connect);
  assert.equal(await move.restoreAccessAll(channel), false, "nothing left to restore");
});
