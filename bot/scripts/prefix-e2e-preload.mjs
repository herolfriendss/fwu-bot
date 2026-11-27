// Préchargement de scripts/prefix-e2e.mjs : le vrai index.js tourne, Discord est simulé (aucun réseau).
import { Client } from "discord.js";
const GUILD_ID = process.env.E2E_GUILD;
const OWNER = process.env.PND_OWNER_DISCORD_ID;
const CHANNEL = "900000000000000300";
const ROLE = "900000000000000200";
function stub(label = "stub") {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.asyncIterator) return async function* () {};
      if (prop === Symbol.toPrimitive) return (hint) => (hint === "number" ? 0 : "");
      if (prop === "toString" || prop === "toJSON") return () => "";
      if (["size", "length", "position", "memberCount"].includes(prop)) return 0;
      if (["has", "some", "every"].includes(prop)) return () => false;
      if (prop === "filter" || prop === "map") return () => [];
      if (["first", "get", "find"].includes(prop)) return () => undefined;
      return stub(`${label}.${String(prop)}`);
    },
    apply() { return stub(`${label}()`); },
  });
}
const wf = (t, label) => new Proxy(t, { get: (o, p) => (p in o ? o[p] : p === "then" ? undefined : stub(`${label}.${String(p)}`)) });
const collection = (entries = []) => {
  const map = new Map(entries);
  map.first = () => map.values().next().value;
  map.filter = (fn) => collection([...map].filter(([, v]) => fn(v)));
  map.map = (fn) => [...map.values()].map(fn);
  map.find = (fn) => [...map.values()].find(fn);
  map.some = (fn) => [...map.values()].some(fn);
  return map;
};
const role = (id = ROLE, position = 5) => wf({ id, name: "Rôle", position, managed: false, permissions: wf({ bitfield: 0n, has: () => false, toArray: () => [] }, "perm"), members: collection(), comparePositionTo: (o) => position - (o?.position ?? 0), editable: true }, "role");
const out = [];
let guild;
const channel = wf({ id: CHANNEL, name: "general", type: 0, guildId: GUILD_ID, isTextBased: () => true, isVoiceBased: () => false,
  send: async (p) => { out.push(p); return wf({ id: "m", edit: async () => ({}), react: async () => {} }, "sent"); },
  sendTyping: async () => {}, permissionsFor: () => wf({ has: () => true, bitfield: 0n }, "cp"),
  messages: wf({ fetch: async () => collection() }, "msgs") }, "channel");
function member(id, admin, position) {
  return wf({ id, user: wf({ id, bot: false, username: "u" + id.slice(-3), tag: "u#0", createdTimestamp: Date.now() - 4e10, displayAvatarURL: () => "https://example.invalid/a.png" }, "user"),
    displayName: "M" + id.slice(-3), get guild() { return guild; }, joinedTimestamp: Date.now() - 1e10,
    permissions: wf({ has: () => admin, bitfield: admin ? 8n : 0n, toArray: () => [] }, "perms"),
    roles: wf({ cache: collection([[ROLE, role()]]), highest: role(ROLE, position), add: async () => {}, remove: async () => {} }, "mr"),
    voice: wf({ channelId: null, channel: null }, "voice"), manageable: true, moderatable: true, kickable: true, bannable: true }, "member");
}
const owner = member(OWNER, true, 50);
const me = member("900000000000000999", true, 99);
guild = wf({ id: GUILD_ID, name: "Serveur", ownerId: OWNER, memberCount: 2,
  members: wf({ cache: collection([[OWNER, owner]]), me, fetch: async (a) => { const id = typeof a === "string" ? a : a?.user; return id ? (id === OWNER ? owner : null) : collection([[OWNER, owner]]); }, fetchMe: async () => me }, "members"),
  roles: wf({ cache: collection([[ROLE, role()], [GUILD_ID, role(GUILD_ID, 0)]]), everyone: role(GUILD_ID, 0), fetch: async () => role() }, "roles"),
  channels: wf({ cache: collection([[CHANNEL, channel]]), fetch: async (id) => (id ? channel : collection([[CHANNEL, channel]])) }, "channels"),
  fetchAuditLogs: async () => ({ entries: collection() }), iconURL: () => null }, "guild");

Client.prototype.login = async function () {
  const client = this;
  Object.defineProperty(client, "user", { value: wf({ id: "900000000000000999", tag: "bot#0", username: "bot", setPresence: () => {} }, "cu"), configurable: true });
  client.guilds.cache.set(GUILD_ID, guild);
  client.isReady = () => true;
  setTimeout(async () => {
    const results = {};
    for (const content of JSON.parse(process.env.E2E_COMMANDS)) {
      out.length = 0;
      const msg = wf({ id: String(Date.now()), content, author: owner.user, member: owner, guild, guildId: GUILD_ID, channel, channelId: CHANNEL,
        mentions: wf({ users: collection(), roles: collection(), members: collection(), everyone: false, channels: collection() }, "mentions"),
        reply: async (p) => { out.push(p); return wf({ id: "r", edit: async () => ({}), react: async () => {} }, "rep"); },
        react: async () => {}, delete: async () => {}, attachments: collection(), createdTimestamp: Date.now(), __replyLayer: undefined }, "msg");
      try { client.emit("messageCreate", msg); } catch (e) { out.push({ error: String(e) }); }
      await new Promise((r) => setTimeout(r, 400));
      results[content] = out.map((p) => { if (typeof p === "string") return p; if (p?.error) return "ERR " + p.error; const e = p?.embeds?.[0]; const d = e?.data ?? e ?? {}; return [p?.content, d.title, d.description, ...(d.fields ?? []).map((f) => f.name + ": " + f.value)].filter(Boolean).join(" | ").slice(0, 400); });
    }
    process.stdout.write("\nE2E_RESULT " + JSON.stringify(results) + "\n");
    process.exit(0);
  }, 1500);
  return "fake";
};
