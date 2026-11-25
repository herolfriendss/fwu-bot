import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../database.js";
import { collectMemberCard, handleMemberCardCommand, memberCardEmbed } from "./member-card.js";
import { recordMemberInvite } from "../../invite-attribution.js";
import { listSysPlusAudit } from "./audit.js";

const G = "card-g";
const U = "400000000000000001";
const T = 1_700_000_000_000;

test("fiche : réunit arrivée, casier et sanctions centrales, sans doublon", async () => {
  recordMemberInvite(G, U, { source: "invite", code: "abc", inviterId: "500" }, T);
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(G, U, "m1", "warn", "spam", "{}", T);
  const card = await collectMemberCard({
    guildId: G, userId: U, now: T + 1000,
    loadCentral: async () => ({ total: 2, items: [
      { action: "warn", reason: "spam", moderatorId: "m1", createdAt: new Date(T + 3000), bot: "fwu" },
      { action: "kick", reason: "raid", moderatorId: "m2", createdAt: new Date(T + 60_000), bot: "guard" },
    ] }),
  });
  assert.equal(card.history.entries.length, 2);
  assert.deepEqual(card.counts, { warn: 1, kick: 1 });
  const embed = memberCardEmbed(card, { user: { id: U, username: "bob", createdTimestamp: T - 1e9 }, member: { joinedTimestamp: T, guild: { id: G }, roles: { cache: new Map() } } }).toJSON();
  const text = embed.fields.map((f) => `${f.name}\n${f.value}`).join("\n");
  assert.match(text, /Invitation `abc` de <@500>/);
  assert.match(text, /Sanctions \(2, tous bots\)/);
  assert.match(text, /Expulsion ×1 · Avertissement ×1/);
  for (const field of embed.fields) assert.ok(field.value.length <= 1024);
});

test("fiche : refusée hors SYS+, et chaque consultation est notée dans l'audit", async () => {
  const replies = [];
  const base = {
    user: { id: "600" }, guildId: G,
    guild: { members: { fetch: async () => null } },
    options: { getUser: () => ({ id: U, username: "bob" }) },
    reply: async (r) => replies.push(r), deferReply: async () => {}, editReply: async (r) => replies.push(r),
  };
  await handleMemberCardCommand(base, { member: {}, roleId: "sys", isSysPlus: () => false, isOwner: false });
  assert.match(replies[0].content, /Réservé aux SYS\+/);
  await handleMemberCardCommand(base, { member: {}, roleId: "sys", isSysPlus: () => true, isOwner: false });
  assert.match(replies[1].embeds[0].toJSON().fields[0].value, /N'est plus sur le serveur/);
  assert.ok(listSysPlusAudit(G, 5, { action: "fiche" }).some((row) => row.actorId === "600" && row.targetId === U));
});
