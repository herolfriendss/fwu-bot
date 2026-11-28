import test from "node:test";
import assert from "node:assert/strict";
import { buildBridgedInteraction, parseBridgedCommand, runPrefixAsSlash, tokenize } from "./prefix-slash-bridge.js";

const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");
const CATALOGUE = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS];
const def = (name) => CATALOGUE.find((c) => c.name === name);

test("tokenize keeps quoted text together", () => {
  assert.deepEqual(tokenize('a "b c" d'), ["a", "b c", "d"]);
});

test("subcommands, typed options and the trailing free text are read from the catalogue", () => {
  const blr = parseBridgedCommand(def("blr"), "poser <@300000000000000003> duree:7j insultes répétées en vocal", { prefix: "=" });
  assert.equal(blr.values.get("duree"), "7j");
  assert.equal(blr.subcommand, "poser");
  assert.equal(blr.values.get("membre"), "300000000000000003");
  assert.equal(blr.values.get("raison"), "insultes répétées en vocal");
  const raid = parseBridgedCommand(def("raid"), "seuils 12 30 15");
  assert.deepEqual([...raid.values.values()], [12, 30, 15]);
  const mvall = parseBridgedCommand(def("mvall"), "<#710000000000000001> <#710000000000000002>");
  assert.equal(mvall.values.get("cible"), "710000000000000002");
  const lever = parseBridgedCommand(def("blr"), "lever <@300000000000000003> oui");
  assert.equal(lever.values.get("restaurer"), true);
});

test("missing required option or unknown subcommand → a usage line with this bot's prefix", () => {
  assert.match(parseBridgedCommand(def("blr"), "poser", { prefix: "=" }).error, /Utilisation : `=blr poser <membre>/);
  assert.match(parseBridgedCommand(def("raid"), "nimporte", { prefix: "+" }).error, /\+raid etat/);
});

test("the simulated interaction answers on the message, private answers go to DM, forms point to the slash command", async () => {
  const replies = [];
  const dms = [];
  const message = {
    content: "=scan", author: { id: "1", send: async (p) => dms.push(p) }, member: {}, guild: { id: "g", members: { cache: new Map() }, roles: { cache: new Map() }, channels: { cache: new Map() } },
    channel: {}, mentions: { users: new Map() },
    reply: async (p) => { replies.push(p); return { edit: async (q) => { replies.push(q); return null; }, delete: async () => {} }; },
  };
  const interaction = buildBridgedInteraction(message, def("scan"), { path: "scan", values: new Map(), subcommand: null, group: null });
  assert.equal(interaction.isChatInputCommand(), true);
  assert.equal(interaction.commandName, "scan");
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content: "public" });
  assert.equal(replies[0].content, "public");
  await interaction.followUp({ content: "secret", ephemeral: true });
  assert.equal(dms[0].content, "secret");
  await interaction.showModal({});
  assert.match(replies.at(-1).content, /formulaire/);
  assert.throws(() => interaction.options.getUser("membre", true), /Option manquante/);
});

test("runPrefixAsSlash dispatches only the bot's own slash commands", async () => {
  const dispatched = [];
  const message = { content: "=raid on test", reply: async () => null, author: { id: "1" }, guild: { id: "g" }, mentions: { users: new Map() } };
  assert.equal(await runPrefixAsSlash(message, { catalogue: CATALOGUE, ownsCommand: (n) => n === "raid", dispatch: (i) => dispatched.push(i) }), true);
  assert.equal(dispatched[0].options.getSubcommand(), "on");
  assert.equal(dispatched[0].options.getString("raison"), "test");
  assert.equal(await runPrefixAsSlash({ ...message, content: "=balance" }, { catalogue: CATALOGUE, ownsCommand: () => false, dispatch: () => {} }), false);
});

test("=staff STAFF CENTER subcommands read their text without quotes", () => {
  const dispo = parseBridgedCommand(def("staff"), "dispo lun-ven 18-23, sam 14-2");
  assert.equal(dispo.values.get("creneaux"), "lun-ven 18-23, sam 14-2");
  const note = parseBridgedCommand(def("staff"), "passation Raid calmé, surveiller le général");
  assert.equal(note.values.get("note"), "Raid calmé, surveiller le général");
  const shift = parseBridgedCommand(def("staff"), "astreinte prendre 4h");
  assert.deepEqual([...shift.values], [["action", "prendre"], ["duree", "4h"]]);
});
