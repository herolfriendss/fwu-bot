import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-dogall-"));
process.env.PND_DOG_STATE_PATH = join(directory, "dog-state.json");
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
writeFileSync(process.env.PND_DOG_STATE_PATH, "{}");

const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { db } = await import("./database.js");

function world(memberIds) {
  const roleItems = [];
  const botMember = { id: "bot", permissions: { has: () => true }, roles: { highest: { position: 10 } } };
  const make = (id, sysplus = false) => {
    const roles = new Set(sysplus ? ["sysplus-role"] : []);
    return {
      id, user: { id, username: id, tag: `${id}#0001`, bot: false }, displayName: id, nickname: null,
      permissions: { has: () => false },
      roles: { highest: { position: sysplus ? 5 : 1 }, cache: { has: (r) => roles.has(r), highest: { position: sysplus ? 5 : 1 } }, add: async (r) => roles.add(r.id), remove: async (r) => roles.delete(r.id) },
      setNickname: async function (n) { this.nickname = n; },
    };
  };
  const actor = make("sys", true);
  const members = memberIds.map((id) => make(id));
  const all = new Map([[actor.id, actor], ...members.map((m) => [m.id, m])]);
  const channel = { id: "voc", members: all };
  for (const m of all.values()) m.voice = { channel, channelId: "voc" };
  const guild = {
    id: `g-${memberIds.length}`, ownerId: "owner",
    channels: { cache: { get: () => channel } },
    members: { cache: { get: (id) => all.get(id) ?? null }, fetchMe: async () => botMember, fetch: async (id) => all.get(typeof id === "string" ? id : id.user) ?? null },
    roles: { cache: { find: (p) => roleItems.find(p), get: (id) => roleItems.find((r) => r.id === id) }, create: async () => { const r = { id: `leash-${roleItems.length}`, name: "En laisse (sys)", managed: false, position: 2 }; roleItems.push(r); return r; } },
  };
  for (const m of all.values()) m.guild = guild;
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true, inGuild: () => true, commandName: "dogall", options: { getUser: () => null },
    user: actor.user, guild, channel: {}, deferReply: async () => {},
    editReply: async (p) => replies.push(p), followUp: async (p) => replies.push(p),
  };
  return { members, replies, run: () => handleV4SlashInteraction(interaction, { sysPlus: { roleId: "sysplus-role" }, dog: { maxActiveLeashes: 3 } }) };
}

test("/dogall leashes everyone in the SYS+'s voice channel when they fit in the limit", async (context) => {
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const small = world(["a", "b"]);
  await small.run();
  assert.match(small.replies[0].content, /\*\*2\*\* membre\(s\)/);
  assert.deepEqual(small.members.map((m) => m.nickname), ["🦮 de sys", "🦮 de sys"]);

  const big = world(["c", "d", "e", "f"]);
  await big.run();
  assert.match(big.replies[0].content, /4 membres à mettre en laisse, mais il ne te reste que \*\*3\*\*/);
  assert.ok(big.members.every((m) => m.nickname === null), "au-delà de la limite, personne n'est mis en laisse");
});
