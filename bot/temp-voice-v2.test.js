import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P } from "discord.js";

const { handleVoiceV2State, handleVoiceV2Interaction } = await import("./voice-v2.js");
const store = await import("./temp-voice-store.js");
const { db } = await import("./database.js");

const G = "860000000000000001";
const BOT = "860000000000000002";
const HUB = "860000000000000010";
const CAT = "860000000000000011";
let nextId = 860000000000001000n;
const snowflake = () => String(nextId++);

function makeGuild() {
  const channels = new Map();
  const members = new Map();
  const created = [];
  const guild = {
    id: G,
    ownerId: "860000000000000999",
    roles: { everyone: { id: G } },
    client: { user: { id: BOT, displayAvatarURL: () => null } },
    members: {
      me: { id: BOT },
      cache: members,
      fetch: async (arg) => {
        const id = typeof arg === "string" ? arg : arg.user;
        const member = members.get(id);
        if (!member) throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        return member;
      },
    },
    channels: {
      cache: channels,
      fetch: async (id) => {
        const channel = channels.get(id);
        if (!channel) throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
        return channel;
      },
      create: async (options) => {
        created.push(options);
        const channel = makeChannel(guild, snowflake(), options);
        channels.set(channel.id, channel);
        return channel;
      },
    },
  };
  guild.created = created;
  channels.set(HUB, makeChannel(guild, HUB, { name: "➕ Créer" }));
  return guild;
}

function makeChannel(guild, id, options = {}) {
  const channel = {
    id, guild, client: guild.client, name: options.name, userLimit: options.userLimit ?? 0, parentId: options.parent ?? null,
    options, members: new Map(), edits: [], sent: [], deleted: false,
    permissionOverwrites: { cache: new Map(), edit: async (target, perms) => { channel.edits.push({ target, perms }); } },
    send: async (payload) => { channel.sent.push(payload); },
    delete: async () => { channel.deleted = true; guild.channels.cache.delete(id); },
    setUserLimit: async (limit) => { channel.userLimit = limit; },
    setName: async (name) => { channel.name = name; },
  };
  return channel;
}

function addMember(guild, id, { bot = false, position = 1, perms = [] } = {}) {
  const member = {
    id, guild, displayName: `Membre ${id.slice(-3)}`,
    user: { id, bot, tag: `m${id.slice(-3)}` },
    roles: { highest: { position } },
    permissions: { has: (perm) => perms.includes(perm) },
    voice: { channelId: null },
  };
  member.voice.setChannel = async (channel) => {
    if (member.failMove) throw new Error("Target user is not connected to voice.");
    join(guild, member, channel.id);
  };
  member.voice.disconnect = async () => leave(guild, member);
  guild.members.cache.set(id, member);
  return member;
}

function join(guild, member, channelId) {
  leave(guild, member);
  member.voice.channelId = channelId;
  guild.channels.cache.get(channelId)?.members.set(member.id, member);
}

function leave(guild, member) {
  if (member.voice.channelId) guild.channels.cache.get(member.voice.channelId)?.members.delete(member.id);
  member.voice.channelId = null;
}

/** Moves the member like Discord does, then fires the voiceStateUpdate handler. */
async function move(guild, member, channelId, settings) {
  const oldState = { guild, id: member.id, channelId: member.voice.channelId, member };
  if (channelId) join(guild, member, channelId); else leave(guild, member);
  const newState = { guild, id: member.id, channelId, member };
  return handleVoiceV2State(oldState, newState, settings);
}

const config = (extra = {}) => ({ tempVoice: { enabled: true, hubChannelId: HUB, categoryId: CAT, defaultLimit: 4, nameTemplate: "Salon de {user}", emptyDeleteSeconds: 0, ...extra } });
const reset = () => {
  db.prepare("DELETE FROM temp_voice").run();
  db.prepare("DELETE FROM temp_voice_lists").run();
  db.prepare("DELETE FROM temp_voice_prefs").run();
};

test("store : un membre n'est que dans une liste, les préférences se complètent", () => {
  reset();
  store.putListEntry({ guildId: G, ownerId: "1", targetId: "2", kind: "trusted" });
  store.putListEntry({ guildId: G, ownerId: "1", targetId: "2", kind: "blocked" });
  assert.deepEqual(store.listEntries(G, "1").map((e) => e.kind), ["blocked"]);
  assert.equal(store.listSize(G, "1", "trusted"), 0);
  assert.equal(store.listEntries("autre-serveur", "1").length, 0, "isolé par serveur");
  assert.equal(store.removeListEntry(G, "1", "2"), true);
  assert.equal(store.removeListEntry(G, "1", "2"), false);
  store.savePrefs({ guildId: G, ownerId: "1", name: "Chill" });
  store.savePrefs({ guildId: G, ownerId: "1", limit: 150 });
  assert.deepEqual(store.getPrefs(G, "1"), { name: "Chill", limit: 99 });
});

test("hub : un seul salon même si l'événement arrive deux fois, préférences et listes appliquées", async () => {
  reset();
  const guild = makeGuild();
  const owner = addMember(guild, "860000000000000100", { position: 3 });
  const friend = addMember(guild, "860000000000000101");
  addMember(guild, "860000000000000102");
  store.savePrefs({ guildId: G, ownerId: owner.id, name: "QG de Ryan", limit: 6 });
  store.putListEntry({ guildId: G, ownerId: owner.id, targetId: friend.id, kind: "trusted" });
  store.putListEntry({ guildId: G, ownerId: owner.id, targetId: "860000000000000102", kind: "blocked" });
  store.putListEntry({ guildId: G, ownerId: owner.id, targetId: "860000000000000777", kind: "trusted" }); // a quitté le serveur

  const oldState = { guild, id: owner.id, channelId: null, member: owner };
  join(guild, owner, HUB);
  const newState = { guild, id: owner.id, channelId: HUB, member: owner };
  await Promise.all([handleVoiceV2State(oldState, newState, config()), handleVoiceV2State(oldState, newState, config())]);

  assert.equal(guild.created.length, 1, "pas de doublon");
  const options = guild.created[0];
  assert.equal(options.name, "QG de Ryan");
  assert.equal(options.userLimit, 6);
  assert.equal(options.parent, CAT);
  const ids = options.permissionOverwrites.map((o) => o.id);
  assert.ok(ids.includes(friend.id) && ids.includes("860000000000000102"));
  assert.ok(!ids.includes("860000000000000777"), "membre parti ignoré");
  const ownerAllow = options.permissionOverwrites.find((o) => o.id === owner.id).allow;
  assert.ok(!ownerAllow.includes(P.MuteMembers) && !ownerAllow.includes(P.DeafenMembers), "pas de mute serveur pour le propriétaire");
  const blocked = options.permissionOverwrites.find((o) => o.id === "860000000000000102");
  assert.deepEqual(blocked.deny, [P.Connect]);

  const row = store.latestTempVoiceOf(G, owner.id);
  assert.equal(owner.voice.channelId, row.channel_id);
  const channel = guild.channels.cache.get(row.channel_id);
  assert.equal(channel.sent.length, 1, "panneau publié dans le salon");
  assert.ok(channel.sent[0].components.length >= 3);
});

test("hub : membre parti avant le déplacement, aucun salon fantôme", async () => {
  reset();
  const guild = makeGuild();
  const member = addMember(guild, "860000000000000110");
  member.failMove = true;
  await move(guild, member, HUB, config());
  assert.equal(guild.created.length, 1);
  assert.equal(guild.channels.cache.size, 1, "seul le hub reste");
  assert.equal(store.allTempVoices().length, 0);
});

test("départ du propriétaire : la propriété passe au membre suivant ; le dernier départ supprime", async () => {
  reset();
  const guild = makeGuild();
  const owner = addMember(guild, "860000000000000120");
  const other = addMember(guild, "860000000000000121");
  await move(guild, owner, HUB, config());
  const channelId = owner.voice.channelId;
  const channel = guild.channels.cache.get(channelId);
  await move(guild, other, channelId, config());
  await move(guild, owner, null, config());
  assert.equal(store.getTempVoice(channelId).owner_id, other.id);
  assert.ok(channel.edits.some((e) => e.target === other.id && e.perms.ManageChannels === true));
  assert.ok(channel.edits.some((e) => e.target === owner.id && e.perms.ManageChannels === null));
  assert.match(channel.sent.at(-1).content, /devient propriétaire/);
  await move(guild, other, null, config());
  assert.equal(channel.deleted, true);
  assert.equal(store.getTempVoice(channelId), null);
});

test("quitter un salon temporaire vers le hub nettoie bien l'ancien salon", async () => {
  reset();
  const guild = makeGuild();
  const owner = addMember(guild, "860000000000000130");
  const guest = addMember(guild, "860000000000000131");
  await move(guild, owner, HUB, config());
  const first = owner.voice.channelId;
  await move(guild, guest, first, config());
  await move(guild, owner, null, config()); // guest becomes owner
  // The guest (now owner) goes to the hub: the emptied channel is deleted, a new one is created.
  await move(guild, guest, HUB, config());
  assert.equal(guild.channels.cache.has(first), false, "ancien salon vide supprimé");
  assert.notEqual(guest.voice.channelId, first);
  assert.equal(store.getTempVoice(guest.voice.channelId).owner_id, guest.id);
});

test("délai de grâce : le salon vide attend, et une arrivée annule la suppression", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const guild = makeGuild();
  const owner = addMember(guild, "860000000000000140");
  const settings = config({ emptyDeleteSeconds: 30 });
  await move(guild, owner, HUB, settings);
  const channelId = owner.voice.channelId;
  await move(guild, owner, null, settings);
  assert.equal(guild.channels.cache.has(channelId), true, "pas encore supprimé");
  await move(guild, owner, channelId, settings);
  t.mock.timers.tick(31_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(guild.channels.cache.has(channelId), true, "arrivée : suppression annulée");
  await move(guild, owner, null, settings);
  t.mock.timers.tick(31_000);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(guild.channels.cache.has(channelId), false, "supprimé après le délai");
});

function interaction(guild, user, customId, { kind = "button", values = [], fields = {} } = {}) {
  const replies = [];
  return {
    guild, guildId: guild.id, user: { id: user.id }, customId, replies, deferred: false, replied: false,
    isButton: () => kind === "button",
    isModalSubmit: () => kind === "modal",
    isUserSelectMenu: () => kind === "user",
    isChatInputCommand: () => false,
    values,
    fields: { getTextInputValue: (key) => fields[key] },
    reply: async function (payload) { this.replied = true; replies.push(payload); },
    deferReply: async function () { this.deferred = true; },
    editReply: async (payload) => { replies.push(payload); },
    showModal: async (modal) => { replies.push({ modal }); },
  };
}

test("panneau : seul le propriétaire (ou le staff) agit, revérifié à chaque clic", async () => {
  reset();
  const guild = makeGuild();
  const owner = addMember(guild, "860000000000000150", { position: 2 });
  const stranger = addMember(guild, "860000000000000151", { position: 5 });
  const staff = addMember(guild, "860000000000000152", { position: 9, perms: [P.ManageChannels] });
  await move(guild, owner, HUB, config());
  const channelId = owner.voice.channelId;
  const channel = guild.channels.cache.get(channelId);

  const refused = interaction(guild, stranger, `tvc:limit:${channelId}`);
  assert.equal(await handleVoiceV2Interaction(refused, config()), true);
  assert.match(refused.replies[0].content, /Seul le propriétaire/);

  const modal = interaction(guild, owner, `tvc:limit:${channelId}`, { kind: "modal", fields: { value: "7" } });
  await handleVoiceV2Interaction(modal, config());
  assert.equal(channel.userLimit, 7);
  assert.equal(store.getPrefs(G, owner.id).limit, 7, "reprise au prochain salon");

  const byStaff = interaction(guild, staff, `tvc:name:${channelId}`, { kind: "modal", fields: { value: "Réunion" } });
  await handleVoiceV2Interaction(byStaff, config());
  assert.equal(channel.name, "Réunion");
  assert.equal(store.getPrefs(G, owner.id).name ?? null, null, "le staff ne change pas les préférences du propriétaire");

  // Discord : 2 renommages par 10 minutes, le troisième est refusé tout de suite.
  await handleVoiceV2Interaction(interaction(guild, owner, `tvc:name:${channelId}`, { kind: "modal", fields: { value: "Deux" } }), config());
  const third = interaction(guild, owner, `tvc:name:${channelId}`, { kind: "modal", fields: { value: "Trois" } });
  await handleVoiceV2Interaction(third, config());
  assert.match(third.replies.at(-1).content, /2 renommages/);
  assert.equal(channel.name, "Deux");

  // Bloquer un membre mieux placé est refusé ; un membre moins bien placé est bloqué et sorti.
  const blockHigh = interaction(guild, owner, `tvc:block:${channelId}`, { kind: "user", values: [stranger.id] });
  await handleVoiceV2Interaction(blockHigh, config());
  assert.match(blockHigh.replies.at(-1).content, /❌/);
  const low = addMember(guild, "860000000000000153", { position: 1 });
  await move(guild, low, channelId, config());
  const blockLow = interaction(guild, owner, `tvc:block:${channelId}`, { kind: "user", values: [low.id] });
  await handleVoiceV2Interaction(blockLow, config());
  assert.match(blockLow.replies.at(-1).content, /bloqué/);
  assert.equal(low.voice.channelId, null);
  assert.equal(store.listEntry(G, owner.id, low.id).kind, "blocked");

  const unknown = interaction(guild, owner, "tvc:limit:860000000000009999");
  await handleVoiceV2Interaction(unknown, config());
  assert.match(unknown.replies[0].content, /n'existe plus/);
});
