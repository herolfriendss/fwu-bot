import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionFlagsBits as P } from "discord.js";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-tools-")), "economy.sqlite");
const sticky = await import("./sticky.js");
const mm = await import("./modmail.js");
const { handleToolsInteraction, canManageMessages, canManageServer } = await import("./tools-commands.js");

const G = "100000000000000321";
const G2 = "100000000000000322";
const STAFF_CH = "300000000000000321";
let n = 0;
const uid = () => `2000000000001${String(++n).padStart(5, "0")}`;

// ─── Sticky ──────────────────────────────────────────────────────────────────

test("sticky text is cleaned and mass mentions are refused", () => {
  assert.equal(sticky.cleanStickyText("Ligne 1\\nLigne 2"), "Ligne 1\nLigne 2");
  assert.throws(() => sticky.cleanStickyText("  "), /vide/);
  assert.throws(() => sticky.cleanStickyText("Venez @everyone"), /@everyone/);
  assert.throws(() => sticky.cleanStickyText("Coucou <@&123>"), /mention de rôle/);
  assert.throws(() => sticky.cleanStickyText("x".repeat(1501)), /trop long/);
  assert.deepEqual(sticky.stickyPayload("a").allowedMentions, { parse: [] });
});

test("one sticky per channel, ten per server, replacing keeps the old message id for cleanup", () => {
  const a = uid();
  assert.equal(sticky.setSticky({ guildId: G, channelId: "c0", content: "v1", authorId: a }).previousMessageId, null);
  sticky.rememberStickyMessage(G, "c0", "m1");
  assert.equal(sticky.setSticky({ guildId: G, channelId: "c0", content: "v2", authorId: a }).previousMessageId, "m1");
  for (let i = 1; i < sticky.STICKY_MAX_PER_GUILD; i++) sticky.setSticky({ guildId: G, channelId: `c${i}`, content: "x", authorId: a });
  assert.throws(() => sticky.setSticky({ guildId: G, channelId: "c99", content: "x", authorId: a }), /10 messages collés/);
  assert.equal(sticky.stickyList(G).length, 10);
  assert.equal(sticky.stickyList(G2).length, 0, "chaque serveur a sa liste");
  for (let i = 1; i < sticky.STICKY_MAX_PER_GUILD; i++) sticky.removeSticky(G, `c${i}`);
  assert.equal(sticky.removeSticky(G, "nope"), null);
});

test("the sticky is reposted once after a burst, the old copy deleted, never when already last", async () => {
  sticky.setSticky({ guildId: G, channelId: "burst", content: "Règles", authorId: uid() });
  const sent = [];
  const deleted = [];
  const channel = {
    id: "burst", guild: { id: G }, lastMessageId: "user-msg",
    send: async (p) => { sent.push(p); return { id: `s${sent.length}`, delete: async () => {} }; },
    messages: { delete: async (id) => { deleted.push(id); } },
  };
  const pending = [];
  const schedule = (fn) => { pending.push(fn); return pending.length; };
  const cancelled = [];
  const msg = { guildId: G, channelId: "burst", channel, author: { id: "u" } };
  for (let i = 0; i < 5; i++) sticky.onStickyChannelMessage(msg, { botUserId: "bot", schedule, cancel: (t) => cancelled.push(t) });
  assert.equal(cancelled.length, 4, "seule la dernière planification reste");
  assert.equal(sticky.onStickyChannelMessage({ ...msg, author: { id: "bot" } }, { botUserId: "bot", schedule }), false, "ses propres messages ne relancent rien");
  assert.equal(sticky.onStickyChannelMessage({ ...msg, channelId: "other" }, { botUserId: "bot", schedule }), false);
  assert.equal(await sticky.repostSticky(channel), true);
  assert.equal(sent.length, 1);
  channel.lastMessageId = "s1";
  assert.equal(await sticky.repostSticky(channel), false, "déjà en bas : rien à faire");
  channel.lastMessageId = "user-2";
  await sticky.repostSticky(channel);
  assert.deepEqual(deleted, ["s1"], "l'ancienne copie est supprimée");
});

// ─── Modmail ─────────────────────────────────────────────────────────────────

const everyone = { id: "everyone" };
const privateChannel = (viewers) => ({
  id: STAFF_CH, guild: { roles: { everyone } },
  permissionsFor: (who) => ({ has: (flag) => flag === P.ViewChannel && who !== everyone && viewers.includes(who?.id) }),
});

test("the modmail channel must be private; staff = whoever can see it", () => {
  const ch = privateChannel(["staff"]);
  assert.equal(mm.isPrivateChannel(ch), true);
  assert.equal(mm.canHandleModmail({ id: "staff" }, ch), true);
  assert.equal(mm.canHandleModmail({ id: "member" }, ch), false);
  const publicCh = { guild: { roles: { everyone } }, permissionsFor: () => ({ has: () => true }) };
  assert.equal(mm.isPrivateChannel(publicCh), false);
  assert.equal(mm.canHandleModmail({ id: "staff" }, publicCh), false, "un salon devenu public bloque les réponses");
});

test("message relay keeps text bounded and only Discord CDN attachments", () => {
  const body = mm.relayBody({
    content: "x".repeat(2000),
    attachments: new Map([
      ["1", { name: "photo.png", url: "https://cdn.discordapp.com/attachments/1/2/photo.png" }],
      ["2", { name: "piege", url: "https://evil.example/x" }],
    ]),
  });
  assert.ok(body.startsWith("x".repeat(1800) + "…"));
  assert.match(body, /📎 \[photo\.png\]\(https:\/\/cdn\.discordapp\.com/);
  assert.doesNotMatch(body, /evil/);
  assert.equal(mm.relayBody({ content: "  ", attachments: new Map() }), null);
});

test("tickets: one open per member across servers, blocks, cooldown after closing", () => {
  const u = uid();
  const t0 = Date.UTC(2026, 10, 25, 12, 0);
  const id = mm.openTicket(G, u, t0);
  assert.throws(() => mm.openTicket(G2, u, t0), /déjà une conversation/, "jamais deux serveurs à la fois");
  mm.attachThread(id, "thread-1");
  assert.equal(mm.ticketByThread("thread-1").user_id, u);
  assert.equal(mm.closeTicket(id, "staff", t0 + 1000), true);
  assert.equal(mm.closeTicket(id, "staff", t0 + 2000), false);
  assert.match(mm.canOpenTicket(G, u, t0 + 60_000).reason, /rouvrir/);
  assert.equal(mm.canOpenTicket(G, u, t0 + mm.MODMAIL_REOPEN_COOLDOWN_MS + 2000).ok, true);
  assert.equal(mm.canOpenTicket(G2, u, t0 + 60_000).ok, true, "le délai est propre à chaque serveur");
  mm.blockModmail(G, u, "staff");
  assert.match(mm.canOpenTicket(G, u, t0 + mm.MODMAIL_REOPEN_COOLDOWN_MS + 2000).reason, /ne reçoit plus/);
  assert.equal(mm.unblockModmail(G, u), true);
});

test("burst limit: five relays per 30 seconds", () => {
  const u = uid();
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(mm.allowBurst(u, t + i), true);
  assert.equal(mm.allowBurst(u, t + 10), false);
  assert.equal(mm.allowBurst(u, t + 31_000), true);
});

function fakeClient({ guilds = [], channels = {}, users = {} } = {}) {
  return {
    user: { id: "bot" },
    guilds: { cache: new Map(guilds.map((g) => [g.id, g])) },
    channels: { fetch: async (id) => channels[id] ?? null },
    users: { fetch: async (id) => users[id] ?? { id, send: async () => {} } },
  };
}

test("a first DM asks which server, then the button opens a staff thread with that message", async () => {
  const u = uid();
  mm.saveModmailConfig(G, { channelId: STAFF_CH, enabled: true });
  const threadMsgs = [];
  const thread = { id: "th-new", isTextBased: () => true, send: async (p) => { threadMsgs.push(p); } };
  const staffChannel = { ...privateChannel(["staff"]), threads: { create: async () => thread } };
  const guild = {
    id: G, name: "PND",
    members: { fetch: async (id) => (id === u ? { id, joinedTimestamp: Date.UTC(2025, 0, 1) } : null) },
    channels: { fetch: async () => staffChannel },
  };
  const other = { id: G2, name: "Autre", members: { fetch: async () => null } };
  const client = fakeClient({ guilds: [guild, other] });
  const replies = [];
  const dm = { author: { id: u, username: "alice", bot: false }, guildId: null, content: "J'ai un souci", attachments: new Map(), reply: async (p) => { replies.push(p); }, react: async () => {} };
  assert.equal(await mm.handleModmailDm(dm, { client, guildAllowed: () => true }), "chooser");
  const buttons = replies[0].components[0].toJSON().components;
  assert.deepEqual(buttons.map((b) => b.custom_id), [`mm:open:${G}`, "mm:cancel"], "seulement les serveurs où le membre est présent");

  const updates = [];
  await handleToolsInteraction({
    isButton: () => true, customId: `mm:open:${G}`, guildId: null,
    user: { id: u, username: "alice", createdTimestamp: Date.UTC(2024, 0, 1), displayAvatarURL: () => undefined },
    update: async (p) => { updates.push(p); },
  }, { client, guildAllowed: () => true });
  assert.match(updates[0].content, /transmis au staff de \*\*PND\*\*/);
  assert.equal(threadMsgs.length, 2);
  assert.match(threadMsgs[1].embeds[0].toJSON().description, /J'ai un souci/);
  assert.ok(threadMsgs.every((p) => p.allowedMentions?.parse?.length === 0), "aucune mention dans le fil");
  assert.equal(mm.openTicketOf(u).thread_id, "th-new");

  // Les MP suivants vont directement dans le fil.
  const clientWithThread = fakeClient({ guilds: [guild], channels: { "th-new": thread } });
  assert.equal(await mm.handleModmailDm({ ...dm, content: "Encore moi" }, { client: clientWithThread, guildAllowed: () => true }), "relayed");
  assert.match(threadMsgs[2].embeds[0].toJSON().description, /Encore moi/);
});

test("the chooser refuses a server the bot should not serve and an expired pending message", async () => {
  const u = uid();
  const updates = [];
  const click = (guildAllowed) => handleToolsInteraction({
    isButton: () => true, customId: `mm:open:${G}`, guildId: null, user: { id: u },
    update: async (p) => { updates.push(p); },
  }, { client: fakeClient({ guilds: [{ id: G, name: "PND", members: { fetch: async () => ({ id: u }) } }] }), guildAllowed });
  await click(() => false);
  assert.match(updates[0].content, /plus disponible/);
  await click(() => true);
  assert.match(updates[1].content, /Trop tard/);
});

test("staff reply: only in a ticket thread, only by staff who see the private channel; anonymous by default", async () => {
  const u = uid();
  const id = mm.openTicket(G, u);
  mm.attachThread(id, "th-reply");
  const sentDm = [];
  const client = fakeClient({ users: { [u]: { id: u, send: async (p) => { sentDm.push(p); } } } });
  const base = { guildId: G, guild: { name: "PND" }, user: { id: "staff", username: "bob" }, member: { id: "staff", displayName: "Bob" }, channel: { parent: privateChannel(["staff"]) } };
  await assert.rejects(mm.replyToMember({ ...base, channelId: "random" }, client, "hello"), /fil d'une conversation/);
  await assert.rejects(mm.replyToMember({ ...base, channelId: "th-reply", member: { id: "intrus" } }, client, "hello"), /Réservé au staff/);
  await assert.rejects(mm.replyToMember({ ...base, channelId: "th-reply", guildId: G2 }, client, "hello"), /fil d'une conversation/, "jamais depuis un autre serveur");
  const sent = await mm.replyToMember({ ...base, channelId: "th-reply" }, client, "Bonjour !");
  assert.equal(sent.anonymous, true);
  assert.equal(sentDm[0].embeds[0].toJSON().author.name, "Staff de PND");
  await mm.replyToMember({ ...base, channelId: "th-reply" }, client, "Signé", false);
  assert.equal(sentDm[1].embeds[0].toJSON().author.name, "Bob · staff de PND");
  const closed = await mm.closeFromThread({ ...base, channelId: "th-reply" }, client, "Réglé");
  assert.equal(closed.id, id);
  assert.match(sentDm[2].content, /a fermé la conversation : Réglé/);
  await assert.rejects(mm.replyToMember({ ...base, channelId: "th-reply" }, client, "trop tard"), /fermée/);
});

// ─── Commandes ───────────────────────────────────────────────────────────────

test("permissions: sticky needs Manage messages, modmail settings need Manage server", async () => {
  const plain = { id: "p", guild: { ownerId: "o" }, permissions: { has: () => false } };
  const mod = { id: "m", guild: { ownerId: "o" }, permissions: { has: (f) => f === P.ManageMessages } };
  assert.equal(canManageMessages(mod), true);
  assert.equal(canManageServer(mod), false);
  const run = async (member, group, sub) => {
    const replies = [];
    await handleToolsInteraction({
      isChatInputCommand: () => true, commandName: "outils", guildId: G, member, user: { id: member.id },
      options: { getSubcommandGroup: () => group, getSubcommand: () => sub, getChannel: () => null, getUser: () => ({ id: "x" }), getBoolean: () => null, getString: () => null },
      reply: async (p) => { replies.push(p); },
    }, { client: fakeClient(), guildAllowed: () => true });
    return replies[0]?.content ?? "";
  };
  assert.match(await run(plain, "sticky", "liste"), /Réservé au staff/);
  assert.match(await run(mod, "sticky", "liste"), /Messages collés|Aucun message collé/);
  assert.match(await run(mod, "modmail", "config"), /Gérer le serveur/);
  assert.match(await run(mod, "modmail", "bloquer"), /Gérer le serveur/);
});

test("a public channel is refused as the modmail channel", async () => {
  const admin = { id: "a", guild: { ownerId: "o" }, permissions: { has: () => true } };
  const replies = [];
  await handleToolsInteraction({
    isChatInputCommand: () => true, commandName: "outils", guildId: G2, member: admin, user: { id: "a" },
    options: {
      getSubcommandGroup: () => "modmail", getSubcommand: () => "config", getBoolean: () => null,
      getChannel: () => ({ id: "pub", type: 0, guild: { roles: { everyone } }, permissionsFor: () => ({ has: () => true }) }),
    },
    reply: async (p) => { replies.push(p); },
  }, { client: fakeClient(), guildAllowed: () => true });
  assert.match(replies[0].content, /visible par @everyone/);
  assert.equal(mm.modmailConfig(G2).enabled, false);
});
