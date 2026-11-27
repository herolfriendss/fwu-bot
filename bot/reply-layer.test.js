import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-reply-layer-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
process.env.PND_OWNER_DISCORD_ID = "900000000000000009";

const layer = await import("./reply-layer.js");
const { db } = await import("./database.js");
after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  delete process.env.PND_OWNER_DISCORD_ID;
  rmSync(directory, { recursive: true, force: true });
});

const {
  shapeReply, detectKind, installReplyLayer, installMessageReplyLayer, handleDossierButton,
  REFUSAL_DELETE_MS, BOT_STYLES, SENSITIVE_ACTIONS, isPlainText, publicSensitiveText,
} = layer;

const ctx = (over = {}) => ({ bot: "guard", commandName: "aide", subcommand: null, surface: "slash", initial: true, ...over });

test("kinds are read from the leading marker", () => {
  assert.equal(detectKind("⛔ Tu ne peux pas."), "refusal");
  assert.equal(detectKind("❌ Erreur"), "refusal");
  assert.equal(detectKind("⚠️ Attention"), "warning");
  assert.equal(detectKind("✅ Fait"), "success");
  assert.equal(detectKind("Bonjour"), "info");
  assert.equal(detectKind({ embeds: [{ title: "⛔ Refusé" }] }), "refusal");
});

test("plain text becomes an embed coloured for the bot, titled by kind", () => {
  const { payload, level } = shapeReply({ content: "✅ Rôle donné.", ephemeral: true }, ctx());
  assert.equal(level, "normal");
  assert.equal(payload.ephemeral, undefined, "public by default");
  assert.equal(payload.content, undefined);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, BOT_STYLES.guard.colors.success);
  assert.match(payload.embeds[0].title, /C'est fait/);
  assert.match(payload.embeds[0].description, /Rôle donné/);
  assert.equal(isPlainText(payload), false);
  const fromString = shapeReply("Bonjour", ctx({ bot: "fisc" })).payload;
  assert.equal(fromString.embeds[0].color, BOT_STYLES.fisc.colors.info);
});

test("refusals are public and deleted after 10 seconds", () => {
  const shaped = shapeReply({ content: "⛔ Tu ne peux agir que sur un membre en dessous.", ephemeral: true }, ctx({ commandName: "dog" }));
  assert.equal(shaped.level, "error");
  assert.equal(shaped.payload.ephemeral, undefined);
  assert.equal(shaped.autoDeleteMs, REFUSAL_DELETE_MS);
  assert.equal(REFUSAL_DELETE_MS, 10_000);
  assert.match(shaped.payload.embeds[0].title, /Refus/);
  assert.equal(shaped.payload.components, undefined, "learn-more button hidden until the guide exists");
});

test("private screens, secrets and explicit private markers stay ephemeral", () => {
  assert.equal(shapeReply({ content: "Panneau", ephemeral: true }, ctx({ commandName: "setup" })).level, "private");
  assert.equal(shapeReply({ content: "Casier", ephemeral: true }, ctx({ commandName: "casier" })).payload.ephemeral, true);
  assert.equal(shapeReply({ content: "Ta confession", ephemeral: true }, ctx({ commandName: "confession" })).level, "private");
  const secret = shapeReply({ content: "Clé : sk-ant-abcdefghijklmnopqrstuvwxyz0123" }, ctx({ commandName: "status" }));
  assert.equal(secret.level, "private");
  assert.equal(secret.payload.ephemeral, true);
  const marked = shapeReply({ content: "Données", visibility: "private" }, ctx());
  assert.equal(marked.payload.ephemeral, true);
  assert.equal(marked.payload.visibility, undefined, "marker never sent to Discord");
});

test("a sensitive success shows only a minimal public line and keeps the details for the staff", () => {
  const detailed = { embeds: [{ title: "✅ Banni", description: "Membre <@300000000000000003> banni.\nRaison : insultes répétées\nDurée : définitive\nPreuve : https://x" }], ephemeral: true };
  const shaped = shapeReply(detailed, ctx({ commandName: "ban", targetId: "300000000000000003" }));
  assert.equal(shaped.level, "sensitive");
  const text = JSON.stringify(shaped.payload);
  assert.doesNotMatch(text, /insultes|Raison|Durée|Preuve/);
  assert.match(shaped.payload.embeds[0].description, /<@300000000000000003>/);
  assert.equal(shaped.payload.ephemeral, undefined);
  assert.equal(shaped.payload.components[0].components[0].custom_id.startsWith("reply:dossier:"), true);
  assert.deepEqual(shaped.dossier.embeds, detailed.embeds);
  // A refusal of a sensitive command is a plain refusal (no dossier).
  assert.equal(shapeReply({ content: "⛔ Hiérarchie" }, ctx({ commandName: "ban", targetId: "3" })).level, "error");
});

test("every sensitive action has a minimal French public text without product name", () => {
  for (const path of Object.keys(SENSITIVE_ACTIONS)) {
    const line = publicSensitiveText(path, "300000000000000003");
    assert.match(line, /<@300000000000000003>/, path);
    assert.doesNotMatch(line, /FWU|PND/, path);
  }
});

test("edits never replace an existing panel with a converted embed", () => {
  const shaped = shapeReply({ content: "Mise à jour" }, ctx({ initial: false, previousVisual: true }));
  assert.equal(shaped.payload.content, "Mise à jour");
  assert.equal(shaped.payload.embeds, undefined);
});

test("component interactions keep their requested visibility", () => {
  const shaped = shapeReply({ content: "⛔ Ce bouton n'est pas pour toi.", ephemeral: true }, ctx({ surface: "component" }));
  assert.equal(shaped.payload.ephemeral, true);
  assert.equal(shaped.autoDeleteMs, 0);
});

test("mentions that must ping stay in the content", () => {
  const shaped = shapeReply({ content: "<@300000000000000003> ton vocal est prêt", allowedMentions: { users: ["300000000000000003"] } }, ctx());
  assert.equal(shaped.payload.content, "<@300000000000000003>");
  assert.match(shaped.payload.embeds[0].description, /ton vocal est prêt/);
});

function fakeInteraction(over = {}) {
  const calls = [];
  const interaction = {
    commandName: "dog",
    guildId: "1",
    options: { getSubcommand: () => null, getSubcommandGroup: () => null, getUser: () => ({ id: "300000000000000003" }) },
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    deferred: false,
    replied: false,
    reply: async (p) => { calls.push(["reply", p]); interaction.replied = true; },
    editReply: async (p) => { calls.push(["editReply", p]); },
    followUp: async (p) => { calls.push(["followUp", p]); },
    deferReply: async (p) => { calls.push(["deferReply", p]); interaction.deferred = true; },
    deleteReply: async () => { calls.push(["deleteReply"]); },
    ...over,
  };
  return { interaction, calls };
}

test("installed on an interaction: refusal public then deleted", async () => {
  const timers = [];
  const { interaction, calls } = fakeInteraction();
  installReplyLayer(interaction, { bot: "suckme", schedule: (fn, ms) => timers.push([fn, ms]) });
  await interaction.reply({ content: "⛔ Non.", ephemeral: true });
  assert.equal(calls[0][1].ephemeral, undefined);
  assert.equal(timers[0][1], 10_000);
  await timers[0][0]();
  assert.deepEqual(calls.at(-1), ["deleteReply"]);
});

test("installed on a prefix message: the bot's refusal message is deleted", async () => {
  const timers = [];
  const deleted = [];
  const message = { reply: async (p) => ({ payload: p, delete: async () => deleted.push(true) }) };
  installMessageReplyLayer(message, { bot: "guard", commandName: "ban", schedule: (fn, ms) => timers.push([fn, ms]) });
  const sent = await message.reply({ content: "❌ Membre introuvable." });
  assert.equal(sent.payload.embeds.length, 1);
  assert.equal(timers[0][1], 10_000);
  await timers[0][0]();
  assert.equal(deleted.length, 1);
});

test("the dossier button answers privately to staff only", async () => {
  const shaped = shapeReply({ embeds: [{ description: "Raison : test" }] }, ctx({ commandName: "kick", targetId: "300000000000000003", guildId: "1" }));
  const id = shaped.payload.components[0].components[0].custom_id;
  const replies = [];
  const click = (member) => ({
    customId: id, guildId: "1", user: { id: member.id }, member,
    isButton: () => true,
    reply: async (p) => replies.push(p),
  });
  const nobody = { id: "5", permissions: { has: () => false }, roles: { cache: { has: () => false } } };
  assert.equal(await handleDossierButton(click(nobody), {}), true);
  assert.equal(replies[0].ephemeral, true);
  assert.doesNotMatch(JSON.stringify(replies[0]), /Raison/);
  const staff = { id: "6", permissions: { has: () => true }, roles: { cache: { has: () => false } } };
  await handleDossierButton(click(staff), {});
  assert.equal(replies[1].ephemeral, true);
  assert.match(JSON.stringify(replies[1]), /Raison : test/);
  assert.equal(await handleDossierButton({ customId: "other", isButton: () => true }, {}), false);
});

test("commande sensible : une aide ou une information n'est jamais présentée comme une action faite", async () => {
  const { shapeReply, isUsageOrNotice } = await import("./reply-layer.js");
  for (const text of ["Utilisation : `=ban @membre|ID [raison]`", "ℹ️ <@1> n'est pas banni.", "Sous-commandes : `+verify moi`"]) {
    assert.equal(isUsageOrNotice(text), true, text);
    const shaped = shapeReply(text, { bot: "guard", commandName: "ban", surface: "prefix", initial: true });
    assert.notEqual(shaped.level, "sensitive", text);
  }
  const done = shapeReply("🔨 <@123456789012345678> banni.", { bot: "guard", commandName: "ban", surface: "prefix", initial: true, targetId: "123456789012345678" });
  assert.equal(done.level, "sensitive");
});
