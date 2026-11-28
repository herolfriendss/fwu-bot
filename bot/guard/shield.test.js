import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-shield-")), "economy.sqlite");
const S = await import("./shield.js");

const GUILD = "100000000000000001";
const TRAP = "400000000000000001";
const snapshot = (over = {}) => ({
  takenAt: Date.now(), guildId: GUILD, name: "Serveur",
  roles: [
    { id: "r1", name: "Staff", color: 1, hoist: true, mentionable: false, position: 5, permissions: "8" },
    { id: "r2", name: "Membre", color: 0, hoist: false, mentionable: false, position: 1, permissions: "0" },
  ],
  channels: [
    { id: "c1", name: "général", type: ChannelType.GuildText, parentId: null, position: 0, topic: null, nsfw: false, overwrites: [] },
    { id: "c2", name: "staff", type: ChannelType.GuildText, parentId: null, position: 1, topic: null, nsfw: false, overwrites: [] },
  ],
  ...over,
});

test("the trap only springs in its own channel", () => {
  const config = { channelId: TRAP, action: "bannir", enabled: true };
  assert.equal(S.honeypotVerdict({ config, channelId: TRAP, isBot: false, isStaff: false, isOwner: false }).trapped, true);
  assert.equal(S.honeypotVerdict({ config, channelId: "999", isBot: false, isStaff: false, isOwner: false }).trapped, false);
});

test("staff, the owner and bots never trip the trap", () => {
  const config = { channelId: TRAP, action: "bannir", enabled: true };
  for (const who of [{ isStaff: true }, { isOwner: true }, { isBot: true }]) {
    const verdict = S.honeypotVerdict({ config, channelId: TRAP, isBot: false, isStaff: false, isOwner: false, ...who });
    assert.equal(verdict.trapped, false, JSON.stringify(who));
  }
});

test("a disabled or missing trap does nothing", () => {
  assert.equal(S.honeypotVerdict({ config: null, channelId: TRAP }).trapped, false);
  assert.equal(S.honeypotVerdict({ config: { channelId: TRAP, enabled: false }, channelId: TRAP }).trapped, false);
});

test("the trap configuration round-trips and refuses an unknown action", () => {
  const saved = S.saveHoneypot(GUILD, TRAP, "quarantaine");
  assert.equal(saved.channelId, TRAP);
  assert.equal(saved.enabled, true);
  assert.throws(() => S.saveHoneypot(GUILD, TRAP, "vaporiser"), /inconnue/);
  S.disableHoneypot(GUILD);
  assert.equal(S.honeypotConfig(GUILD).enabled, false);
});

test("a snapshot is saved, listed and read back whole", () => {
  const id = S.saveSnapshot({ guildId: GUILD, label: "avant refonte", payload: snapshot(), createdBy: "200000000000000001" });
  const listed = S.listSnapshots(GUILD);
  assert.equal(listed[0].id, id);
  assert.equal(listed[0].roles, 2);
  assert.equal(listed[0].channels, 2);
  assert.equal(S.loadSnapshot(GUILD, id).payload.channels.length, 2);
  assert.equal(S.loadSnapshot("100000000000000002", id), null, "une sauvegarde reste à son serveur");
});

test("only the most recent snapshots are kept", () => {
  const guild = "100000000000000003";
  for (let i = 0; i < S.MAX_SNAPSHOTS + 3; i += 1) {
    S.saveSnapshot({ guildId: guild, label: `n${i}`, payload: snapshot(), createdBy: "x", now: Date.now() + i });
  }
  const kept = S.listSnapshots(guild);
  assert.equal(kept.length, S.MAX_SNAPSHOTS);
  assert.equal(kept[0].label, `n${S.MAX_SNAPSHOTS + 2}`, "la plus récente est gardée");
});

test("restoring a healthy server plans nothing", () => {
  const plan = S.planRestore(snapshot(), snapshot());
  assert.equal(plan.empty, true);
  assert.equal(plan.missingRoles.length, 0);
  assert.equal(plan.missingChannels.length, 0);
});

test("the plan lists what disappeared and never plans a deletion", () => {
  const before = snapshot();
  const after = snapshot({
    roles: [before.roles[1]],
    channels: [
      before.channels[0],
      { id: "c9", name: "nouveau", type: ChannelType.GuildText, parentId: null, position: 2, topic: null, nsfw: false, overwrites: [] },
    ],
  });
  const plan = S.planRestore(before, after);
  assert.equal(plan.missingRoles.length, 1);
  assert.equal(plan.missingRoles[0].name, "Staff");
  assert.equal(plan.missingChannels.length, 1);
  assert.equal(plan.missingChannels[0].name, "staff");
  assert.equal(plan.addedSinceSnapshot, 1);
  assert.ok(!("delete" in plan), "une restauration ne supprime jamais");
});

test("a channel re-created by hand under the same name is not duplicated", () => {
  const before = snapshot();
  const after = snapshot({
    channels: [
      before.channels[0],
      { ...before.channels[1], id: "autre-id" },
    ],
  });
  assert.equal(S.planRestore(before, after).missingChannels.length, 0);
});

test("a role re-created under the same name is not duplicated either", () => {
  const before = snapshot();
  const after = snapshot({ roles: [{ ...before.roles[0], id: "nouvel-id" }, before.roles[1]] });
  assert.equal(S.planRestore(before, after).missingRoles.length, 0);
});

test("lockdown records which channels it closed, and lifting needs a lockdown", async () => {
  const guild = "100000000000000004";
  assert.equal(S.lockdownState(guild), null);
  await assert.rejects(() => S.liftLockdown({ id: guild, channels: { cache: new Map() } }), /n'est pas verrouillé/);
});

test("shield restoration keeps snapshot role color and uses the current Discord colors payload", async () => {
  const before = snapshot();
  const current = snapshot({ roles: [before.roles[1]] });
  const plan = S.planRestore(before, current);
  const calls = [];
  const guild = {
    roles: {
      create: async (options) => { calls.push(options); return { id: "restored-role" }; },
    },
    channels: { cache: new Map() },
  };
  const result = await S.applyRestore(guild, plan);
  assert.equal(result.created.roles, 1);
  assert.equal(calls[0].color, undefined);
  assert.equal(calls[0].colors.primaryColor, before.roles[0].color);
});
