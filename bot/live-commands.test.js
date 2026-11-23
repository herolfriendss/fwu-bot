import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_DENIED, canConfigureLive, describeLive, handleLiveMessage, parseLivePrefix, planLiveChange } from "./live-commands.js";

const OWNER = "100000000000000001";
process.env.PND_OWNER_DISCORD_ID = OWNER;
const okFeed = async (value) => { if (!/^https:\/\//.test(value)) throw new Error("bad"); return new URL(value); };
const member = (id, roles = []) => ({ id, guild: { id: "g" }, roles: { cache: new Map(roles.map((r) => [r, {}])) }, permissions: { has: () => false } });

test("access: OWNER and SYS+ only", () => {
  assert.equal(canConfigureLive(member(OWNER), {}), true);
  assert.equal(canConfigureLive(member("100000000000000002", ["r"]), { sysPlus: { roleId: "r" } }), true);
  assert.equal(canConfigureLive(member("100000000000000003"), { sysPlus: { roleId: "r" } }), false);
});

test("on/off, channel, mention role (never @everyone)", async () => {
  let r = await planLiveChange({}, "on");
  assert.equal(r.next.enabled, true);
  assert.match(r.text, /Choisis maintenant un salon/);
  r = await planLiveChange(r.next, "channel", { channelId: "123456789" });
  assert.equal(r.next.channelId, "123456789");
  r = await planLiveChange(r.next, "role", { roleId: "555555555" }, { guildId: "g" });
  assert.equal(r.next.mentionRoleId, "555555555");
  await assert.rejects(planLiveChange(r.next, "role", { roleId: "999999999" }, { guildId: "999999999" }), /everyone/);
  r = await planLiveChange(r.next, "role", { roleId: null });
  assert.equal(r.next.mentionRoleId, null);
  assert.equal((await planLiveChange(r.next, "off")).next.enabled, false);
});

test("add and remove creators, with feed validation and limits", async () => {
  let r = await planLiveChange({}, "add", { platform: "twitch", name: "Tax", feedUrl: "https://example.com/feed.xml" }, { validateFeed: okFeed });
  assert.equal(r.next.creators.length, 1);
  assert.equal(r.next.creators[0].displayName, "Tax");
  await assert.rejects(planLiveChange(r.next, "add", { platform: "twitch", name: "tax", feedUrl: "https://example.com/2" }, { validateFeed: okFeed }), /déjà suivi/);
  await assert.rejects(planLiveChange(r.next, "add", { platform: "myspace", name: "X", feedUrl: "https://x" }, { validateFeed: okFeed }), /Plateforme/);
  await assert.rejects(planLiveChange(r.next, "add", { platform: "youtube", name: "X", feedUrl: "http://x" }, { validateFeed: okFeed }), /HTTPS publique/);
  const full = { creators: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, platform: "youtube", displayName: `C${i}`, feedUrl: "https://x" })) };
  await assert.rejects(planLiveChange(full, "add", { platform: "youtube", name: "New", feedUrl: "https://x" }, { validateFeed: okFeed }), /Maximum 30/);
  r = await planLiveChange(r.next, "remove", { name: "TAX" });
  assert.equal(r.next.creators.length, 0);
  await assert.rejects(planLiveChange(r.next, "remove", { name: "Nope" }), /introuvable/);
});

test("status text and prefix parsing", () => {
  assert.match(describeLive({ enabled: true, creators: [] }), /Choisis un salon/);
  const msg = (content, extra = {}) => ({ content, mentions: { channels: { first: () => null }, roles: { first: () => null } }, ...extra });
  assert.deepEqual(parseLivePrefix(msg("=live")), { action: "status", args: {} });
  assert.deepEqual(parseLivePrefix(msg("=live on")), { action: "on", args: {} });
  assert.deepEqual(parseLivePrefix(msg("=live ajouter youtube https://x.test/f Tax Officiel")), { action: "add", args: { platform: "youtube", feedUrl: "https://x.test/f", name: "Tax Officiel" } });
  assert.deepEqual(parseLivePrefix(msg("=live role aucun")), { action: "role", args: { roleId: null } });
  assert.deepEqual(parseLivePrefix(msg("=live salon <#123456789>")), { action: "channel", args: { channelId: "123456789" } });
  assert.equal(parseLivePrefix(msg("=livestream")), null);
  assert.equal(parseLivePrefix(msg("=live nimportequoi")).action, "help");
});

test("members are refused; status needs no write", async () => {
  const replies = [];
  const message = (id, content) => ({ content, guild: { id: "g" }, member: member(id), mentions: {}, reply: async (p) => replies.push(p) });
  await handleLiveMessage(message("100000000000000003", "=live on"), {}, {});
  assert.equal(replies.at(-1).content, LIVE_DENIED);
  await handleLiveMessage(message(OWNER, "=live"), { g: { liveAlerts: { enabled: false, creators: [] } } }, {});
  assert.match(replies.at(-1).content, /Alertes LIVE\*\* : désactivées/);
});
