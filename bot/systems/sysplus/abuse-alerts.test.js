import { test } from "node:test";
import assert from "node:assert/strict";
import { abuseAlertRecipients, handleAbuseAlertCommand } from "./abuse-alerts.js";
import { ownerId } from "../../shared/tiers.js";

function fakeGuild(members) {
  const map = new Map(members.map((m) => [m.id, m]));
  return { name: "PND", members: { fetch: async () => map }, roles: { cache: new Map([["sys", { members: map }]]) } };
}

test("destinataires : owner + SYS+, jamais le membre signalé ni un bot", async () => {
  const guild = fakeGuild([{ id: "s1", user: {} }, { id: "s2", user: {} }, { id: "b1", user: { bot: true } }]);
  const ids = await abuseAlertRecipients(guild, "sys", "s2");
  assert.ok(ids.includes("s1"));
  assert.ok(!ids.includes("s2"), "le SYS+ signalé ne reçoit pas l'alerte");
  assert.ok(!ids.includes("b1"));
  if (ownerId()) assert.ok(ids.includes(ownerId()) || ownerId() === "s2");
});

function fakeInteraction(userId, values = {}) {
  const replies = [];
  return {
    replies, user: { id: userId }, guildId: "g", guild: {},
    options: { getBoolean: (k) => values[k] ?? null, getInteger: (k) => values[k] ?? null },
    reply: async (r) => replies.push(r), deferReply: async () => {}, editReply: async (r) => replies.push(r),
  };
}

test("alerte-abus : refusée aux non-SYS+, et un SYS+ ne peut pas couper l'alerte", async () => {
  const outsider = fakeInteraction("x1");
  await handleAbuseAlertCommand(outsider, { bot: "fwu", member: {}, roleId: "sys", isSysPlus: () => false });
  assert.match(outsider.replies[0].content, /Réservé aux SYS\+/);
  const sys = fakeInteraction("x2", { active: false });
  await handleAbuseAlertCommand(sys, { bot: "fwu", member: {}, roleId: "sys", isSysPlus: () => true });
  assert.match(String(sys.replies[0]), /Seul l'owner/);
});
