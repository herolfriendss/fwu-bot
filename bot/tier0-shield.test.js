// Rôle 0 % intouchable : Discord simulé, aucun réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent } from "discord.js";

process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
const {
  handleTier0VoiceState, handleTier0MemberUpdate, handleTier0Ban, handleTier0Kick,
  isTier0Role, isTier0Protected, primeTier0Members, resetTier0State, setTier0AuditWaitsForTests,
} = await import("./tier0-shield.js");
setTier0AuditWaitsForTests([0]);
const { setRoleTiersForTests } = await import("./shared/tiers.js");
setRoleTiersForTests("g1", [["zero", 0], ["ten", 10], ["hundred", 100]]);

const OWNER = "100000000000000001";
const PROTECTED = "200000000000000001";
const MEMBER = "300000000000000001";
const ATTACKER = "400000000000000001";

function world({ auditEntries = [], failWith = null } = {}) {
  const calls = [];
  const logs = [];
  const roles = new Map([
    ["zero", { id: "zero", name: "0%", members: new Map([[PROTECTED, {}]]) }],
    ["ten", { id: "ten", name: "10%", members: new Map() }],
    ["hundred", { id: "hundred", name: "100%", members: new Map() }],
  ]);
  const guild = {
    id: "g1",
    client: { user: { id: "bot" } },
    roles: { cache: roles },
    members: { fetch: async () => null, me: { id: "bot" } },
    fetchAuditLogs: async ({ type }) => {
      calls.push(`audit:${type}`);
      return { entries: new Map(auditEntries.filter((e) => e.type === undefined || e.type === type).map((e, i) => [String(i), { createdTimestamp: Date.now(), ...e }])) };
    },
    bans: { remove: async (id) => { calls.push(`unban:${id}`); } },
  };
  const member = (id, roleIds, extra = {}) => ({
    id, guild, user: { id, bot: false },
    roles: {
      cache: new Map(roleIds.map((r) => [r, roles.get(r)])),
      add: async (ids) => { calls.push(`addRole:${ids}`); },
    },
    nickname: extra.nickname ?? null,
    communicationDisabledUntilTimestamp: extra.until ?? null,
    timeout: async (value) => { if (failWith) throw failWith; calls.push(`timeout:${value}`); },
    setNickname: async (value) => { calls.push(`nick:${value}`); },
  });
  const voice = (m, state) => ({
    guild, member: m, id: m.id, channelId: state.channelId ?? "vc",
    serverMute: Boolean(state.serverMute), serverDeaf: Boolean(state.serverDeaf),
    selfMute: Boolean(state.selfMute), selfDeaf: Boolean(state.selfDeaf),
    setMute: async (v) => { if (failWith) throw failWith; calls.push(`mute:${v}`); },
    setDeaf: async (v) => { if (failWith) throw failWith; calls.push(`deaf:${v}`); },
  });
  const audit = async (_guild, title, description) => { logs.push(`${title} | ${description}`); };
  return { guild, calls, logs, member, voice, audit, record: () => {} };
}

const muteEntry = (executor, key = "mute") => ({ target: { id: PROTECTED }, executor: { id: executor }, changes: [{ key }], type: AuditLogEvent.MemberUpdate });

test.beforeEach(() => { resetTier0State(); delete process.env.PND_TIER0_PROTECTION; });

test("seule l'association /quota palier 0 protège ; un rôle nommé « 0% » ne protège pas", () => {
  assert.equal(isTier0Role({ id: "a", name: "0%" }), false, "faille « Moi 0 % » fermée");
  assert.equal(isTier0Role({ id: "a", name: "Moi 0 %" }), false);
  assert.equal(isTier0Role({ id: "a", name: "Staff" }, new Map([["a", 0]])), true, "association explicite au palier 0");
  assert.equal(isTier0Role({ id: "a", name: "0%" }, new Map([["a", 10]])), false);
});

test("micro coupé par clic droit : rétabli INSTANTANÉMENT, avant même de chercher l'auteur", async () => {
  const w = world({ auditEntries: [muteEntry(ATTACKER)] });
  const m = w.member(PROTECTED, ["zero"]);
  const result = await handleTier0VoiceState(w.voice(m, {}), w.voice(m, { serverMute: true }), w);
  assert.deepEqual(result, { isProtected: true, reverted: 1 });
  assert.equal(w.calls[0], "mute:false", "le démute part en premier");
  assert.ok(w.calls.indexOf("mute:false") < w.calls.findIndex((c) => c.startsWith("audit")));
  assert.match(w.logs[0], /micro coupé annulé/);
  assert.match(w.logs[0], new RegExp(`Auteur : <@${ATTACKER}>`));
});

test("casque coupé (sourdine serveur) : rétabli aussi, en même temps que le micro", async () => {
  const w = world({ auditEntries: [muteEntry(ATTACKER, "deaf")] });
  const m = w.member(PROTECTED, ["zero"]);
  await handleTier0VoiceState(w.voice(m, {}), w.voice(m, { serverMute: true, serverDeaf: true }), w);
  assert.deepEqual(w.calls.filter((c) => !c.startsWith("audit")), ["mute:false", "deaf:false"]);
});

test("l'owner est protégé même sans le rôle", async () => {
  const w = world();
  const m = w.member(OWNER, []);
  assert.equal((await handleTier0VoiceState(w.voice(m, {}), w.voice(m, { serverMute: true }), w)).reverted, 1);
});

test("membre non protégé, ou micro coupé par la personne elle-même (self-mute) : rien n'est touché", async () => {
  const w = world();
  const normal = w.member(MEMBER, ["ten"]);
  assert.deepEqual(await handleTier0VoiceState(w.voice(normal, {}), w.voice(normal, { serverMute: true }), w), { isProtected: false, reverted: 0 });
  const p = w.member(PROTECTED, ["zero"]);
  assert.equal((await handleTier0VoiceState(w.voice(p, {}), w.voice(p, { selfMute: true, selfDeaf: true }), w)).reverted, 0);
  assert.deepEqual(w.calls, []);
});

test("acharnement : 8 annulations par minute, puis alerte « intervention humaine »", async () => {
  const w = world();
  const m = w.member(PROTECTED, ["zero"]);
  let reverted = 0;
  for (let i = 0; i < 10; i++) reverted += (await handleTier0VoiceState(w.voice(m, {}), w.voice(m, { serverMute: true }), w)).reverted;
  assert.equal(reverted, 8);
  assert.ok(w.logs.some((l) => /annulation suspendue/.test(l)));
});

test("bot sans permission : l'échec est journalisé, aucun plantage", async () => {
  const w = world({ failWith: Object.assign(new Error("Missing Permissions"), { code: 50013 }) });
  const m = w.member(PROTECTED, ["zero"]);
  assert.equal((await handleTier0VoiceState(w.voice(m, {}), w.voice(m, { serverMute: true }), w)).reverted, 0);
  assert.match(w.logs[0], /impossible à annuler.*Permission manquante/s);
});

test("protection désactivée (PND_TIER0_PROTECTION=off) : plus aucune annulation", async () => {
  process.env.PND_TIER0_PROTECTION = "off";
  const w = world();
  const m = w.member(PROTECTED, ["zero"]);
  assert.equal(await isTier0Protected(m), false);
  assert.equal((await handleTier0VoiceState(w.voice(m, {}), w.voice(m, { serverMute: true }), w)).reverted, 0);
});

test("exclusion temporaire : levée immédiatement", async () => {
  const w = world();
  const before = w.member(PROTECTED, ["zero"]);
  const after = w.member(PROTECTED, ["zero"], { until: Date.now() + 600_000 });
  assert.equal(await handleTier0MemberUpdate(before, after, w), 1);
  assert.equal(w.calls[0], "timeout:null");
});

test("pseudo : changé par la personne elle-même → gardé ; changé par un autre → remis", async () => {
  const self = world({ auditEntries: [{ target: { id: PROTECTED }, executor: { id: PROTECTED }, changes: [{ key: "nick" }], type: AuditLogEvent.MemberUpdate }] });
  assert.equal(await handleTier0MemberUpdate(self.member(PROTECTED, ["zero"], { nickname: "Boss" }), self.member(PROTECTED, ["zero"], { nickname: "Nouveau" }), self), 0);
  const other = world({ auditEntries: [{ target: { id: PROTECTED }, executor: { id: ATTACKER }, changes: [{ key: "nick" }], type: AuditLogEvent.MemberUpdate }] });
  assert.equal(await handleTier0MemberUpdate(other.member(PROTECTED, ["zero"], { nickname: "Boss" }), other.member(PROTECTED, ["zero"], { nickname: "lol" }), other), 1);
  assert.ok(other.calls.includes("nick:Boss"));
});

test("rôle 0 % retiré par quelqu'un d'autre : remis", async () => {
  const w = world({ auditEntries: [{ target: { id: PROTECTED }, executor: { id: ATTACKER }, changes: [{ key: "$remove" }], type: AuditLogEvent.MemberRoleUpdate }] });
  assert.equal(await handleTier0MemberUpdate(w.member(PROTECTED, ["zero"]), w.member(PROTECTED, []), w), 1);
  assert.ok(w.calls.includes("addRole:zero"));
});

test("bannissement d'un membre protégé : débanni aussitôt ; expulsion : signalée", async () => {
  const w = world({ auditEntries: [{ target: { id: PROTECTED }, executor: { id: ATTACKER }, type: AuditLogEvent.MemberKick }] });
  await primeTier0Members(w.guild);
  assert.equal(await handleTier0Ban({ guild: w.guild, user: { id: PROTECTED } }, w), true);
  assert.ok(w.calls.includes(`unban:${PROTECTED}`));
  assert.equal(await handleTier0Ban({ guild: w.guild, user: { id: MEMBER } }, w), false, "un membre ordinaire reste banni");
  assert.equal(await handleTier0Kick(w.member(PROTECTED, ["zero"]), w), true);
  assert.ok(w.logs.some((l) => /expulsion/.test(l) && l.includes(ATTACKER)));
});
