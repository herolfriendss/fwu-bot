import test from "node:test";
import assert from "node:assert/strict";
import { REPORT, REPORT_MENU_NAME, closeReport, createReport, getReport, handleReportInteraction, reportButtons, reportRefusal } from "./report-message.js";

const base = { guildId: "g1", channelId: "c1", authorId: "a1", reporterId: "r1" };

test("garde-fous : pas de bot, pas soi-même, une fois par message, 5 par 10 min", () => {
  assert.match(reportRefusal({ ...base, messageId: "m0", authorIsBot: true }), /bot/);
  assert.match(reportRefusal({ ...base, messageId: "m0", authorId: "r1" }), /propre message/);
  assert.equal(reportRefusal({ ...base, messageId: "m1" }, 1_000), null);
  createReport({ ...base, messageId: "m1" }, 1_000);
  assert.match(reportRefusal({ ...base, messageId: "m1" }, 1_001), /déjà signalé/);
  for (let i = 2; i <= REPORT.perUserLimit; i++) createReport({ ...base, messageId: `m${i}` }, 1_000 + i);
  assert.match(reportRefusal({ ...base, messageId: "m99" }, 2_000), /Trop de signalements/);
  assert.equal(reportRefusal({ ...base, messageId: "m99" }, 2_000 + REPORT.windowMs), null);
});

test("traitement : une seule fois, tous les signalements du message fermés", () => {
  const a = createReport({ ...base, guildId: "g2", messageId: "x1", reporterId: "u1" }, 5);
  const b = createReport({ ...base, guildId: "g2", messageId: "x1", reporterId: "u2" }, 6);
  assert.equal(closeReport(a, "deleted", "staff", 7), true);
  assert.equal(getReport(b).status, "deleted");
  assert.equal(closeReport(b, "ignored", "staff", 8), false);
  assert.deepEqual(reportButtons("g2", a)[0].components.map((c) => c.custom_id), [`report:delete:g2:${a}`, `report:mute:g2:${a}`, `report:ignore:g2:${a}`]);
});

test("clic droit → formulaire ; boutons réservés au staff ; Ignorer ferme le signalement", async () => {
  let modal = null;
  const menu = { isMessageContextMenuCommand: () => true, commandName: REPORT_MENU_NAME, guild: { id: "g3" }, user: { id: "r3" },
    targetMessage: { id: "y1", channelId: "c3", author: { id: "a3", bot: false } }, showModal: async (m) => { modal = m; } };
  assert.equal(await handleReportInteraction(menu, {}), true);
  assert.equal(modal.data.custom_id, "report:modal:c3:y1");
  const id = createReport({ ...base, guildId: "g3", messageId: "y1", reporterId: "r3", authorId: "a3" });
  const replies = [];
  let updated = null;
  const member = (perm) => ({ id: "s1", displayName: "Modo", permissions: { has: () => perm }, guild: { ownerId: "o" } });
  const guild = (perm) => ({ members: { fetch: async () => member(perm) }, channels: { cache: new Map() } });
  const click = { isButton: () => true, customId: `report:ignore:g3:${id}`, user: { id: "s1" }, reply: async (p) => replies.push(p), update: async (p) => { updated = p; } };
  assert.equal(await handleReportInteraction(click, { client: { guilds: { cache: new Map([["g3", guild(false)]]) } } }), true);
  assert.match(replies[0].content, /Réservé au staff/);
  assert.equal(getReport(id).status, "open");
  await handleReportInteraction(click, { client: { guilds: { cache: new Map([["g3", guild(true)]]) } } });
  assert.equal(getReport(id).status, "ignored");
  assert.match(updated.components[0].components[0].label, /Ignoré par Modo/);
  assert.equal(await handleReportInteraction({ isButton: () => true, customId: "autre" }, {}), false);
});
