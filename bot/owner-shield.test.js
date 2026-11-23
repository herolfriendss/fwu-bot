import assert from "node:assert/strict";
import test from "node:test";
import { GuildBanManager, GuildChannelManager, GuildMemberManager, GuildMemberRoleManager, PermissionFlagsBits, PermissionOverwriteManager } from "discord.js";
import { OwnerShieldError, harmfulMemberEdit, installOwnerShield, overwritesHarmOwner, runAsActor } from "./owner-shield.js";

const OWNER = "100000000000000001";
process.env.PND_OWNER_DISCORD_ID = OWNER;
const blocked = [];
installOwnerShield({ report: (action) => blocked.push(action) });

const client = { users: { resolveId: (u) => (typeof u === "string" ? u : u?.id) } };
const fake = (Proto, extra = {}) => { const o = Object.create(Proto.prototype); for (const [k, v] of Object.entries({ client, ...extra })) Object.defineProperty(o, k, { value: v }); return o; };
const members = () => fake(GuildMemberManager, { cache: new Map([[OWNER, { roles: { cache: new Map([["r1", {}], ["r2", {}]]) } }]]) });

// A call that passes the shield reaches the real discord.js code, which fails on the fake: not a shield error.
async function passes(fn) {
  try { await fn(); } catch (error) { assert.ok(!(error instanceof OwnerShieldError), `bloqué à tort : ${error.message}`); }
}
const refuses = (fn) => assert.rejects(fn, OwnerShieldError);

test("harmful changes to the OWNER are refused before reaching Discord", async () => {
  await refuses(() => members().edit(OWNER, { nick: "x" }));
  await refuses(() => members().edit(OWNER, { communicationDisabledUntil: Date.now() + 60_000 }));
  await refuses(() => members().edit(OWNER, { mute: true }));
  await refuses(() => members().edit(OWNER, { channel: null }));
  await refuses(() => members().edit(OWNER, { roles: ["r1"] }));
  await refuses(() => members().kick(OWNER));
  await refuses(() => fake(GuildBanManager).create(OWNER, {}));
  await refuses(() => fake(GuildMemberRoleManager, { member: { id: OWNER } }).remove("r1"));
  await refuses(() => fake(PermissionOverwriteManager, { channel: {} }).upsert(OWNER, { Connect: false }, { type: 1 }));
  await refuses(() => fake(GuildChannelManager).create({ name: "pv", permissionOverwrites: [{ id: OWNER, deny: [PermissionFlagsBits.Connect] }] }));
  await refuses(() => fake(GuildChannelManager).edit("1", { permissionOverwrites: [{ id: OWNER, deny: [PermissionFlagsBits.ViewChannel] }] }));
  assert.ok(blocked.length >= 11);
});

test("harmless changes and other members are not affected", async () => {
  await passes(() => members().edit(OWNER, { roles: ["r1", "r2", "r3"] }));
  await passes(() => members().edit(OWNER, { communicationDisabledUntil: null, mute: false }));
  await passes(() => fake(PermissionOverwriteManager, { channel: {} }).upsert(OWNER, { Connect: true }, { type: 1 }));
  await passes(() => members().kick("200000000000000002"));
  await passes(() => fake(GuildBanManager).create("200000000000000002", {}));
});

test("the OWNER's own commands are never blocked", async () => {
  await runAsActor(OWNER, async () => {
    await passes(() => members().edit(OWNER, { nick: "moi" }));
    await passes(() => fake(GuildMemberRoleManager, { member: { id: OWNER } }).remove("r1"));
  });
  await runAsActor("300000000000000003", () => refuses(() => members().edit(OWNER, { nick: "x" })));
});

test("pure helpers", () => {
  assert.deepEqual(harmfulMemberEdit({ roles: ["a"] }, new Set(["a"])), []);
  assert.deepEqual(harmfulMemberEdit({ roles: ["a"] }, new Set(["a", "b"])), ["retrait de rôle"]);
  assert.equal(overwritesHarmOwner([{ id: OWNER, allow: ["Connect"] }], OWNER), false);
  assert.equal(overwritesHarmOwner([{ id: OWNER, deny: ["Connect"] }], OWNER), true);
  assert.equal(overwritesHarmOwner([{ id: OWNER, deny: [] }], OWNER), false);
});
