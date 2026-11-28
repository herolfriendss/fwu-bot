import test from "node:test";
import assert from "node:assert/strict";
import { HELP_PAGE_SIZE, HELP_TUTORIALS, botPageEmbed, commandsByBot, handleHelpComponent, helpPayload, helpViewFromInteraction, overviewEmbed, permissionsEmbed, tutorialPayload } from "./help-panel.js";

const profiles = {
  fwu: { id: "fwu", label: "Bot principal", summary: "Modération" },
  guard: { id: "guard", label: "GUARD", summary: "Sécurité" },
};
const prefixes = { fwu: null, guard: "+" };
const catalog = [
  { name: "aide", description: "Aide" },
  { name: "tempmute", description: "Rend muet" },
  { name: "ban", description: "Bannit", defaultMemberPermissions: "4" },
  ...Array.from({ length: 25 }, (_, i) => ({ name: `g${String(i).padStart(2, "0")}`, description: "x".repeat(120) })),
];
const owners = (name) => (name === "aide" ? null : name === "tempmute" ? "fwu" : "guard");
const commands = commandsByBot(catalog, owners);
const ctx = { profiles, prefixes, commands };

test("commandes rangées par bot, aide partagée exclue, quota et permission repérés", () => {
  assert.deepEqual(commands.fwu.map((c) => c.name), ["tempmute"]);
  assert.equal(commands.fwu[0].quota, true);
  assert.equal(commands.guard.find((c) => c.name === "ban").permission, "Bannir");
  assert.equal(commands.guard.length, 26);
});

test("pages : préfixe du bot, 20 par page, descriptions coupées, sous les limites Discord", () => {
  const first = botPageEmbed({ ...ctx, botId: "guard", page: 0 });
  assert.equal(first.pages, 2);
  assert.match(first.embed.description, /`\+ban` ⏳🔒 Bannit/);
  assert.equal(first.embed.description.split("\n").length, HELP_PAGE_SIZE);
  assert.ok(first.embed.description.length < 4096);
  assert.match(botPageEmbed({ ...ctx, botId: "fwu" }).embed.description, /`\/tempmute` ⏳ Rend muet/);
  assert.equal(botPageEmbed({ ...ctx, botId: "guard", page: 99 }).page, 1, "page bornée");
});

test("vue d'ensemble et permissions : préfixes, paliers, tempmute expliqué", () => {
  const overview = overviewEmbed(ctx);
  assert.match(overview.fields[1].name, /GUARD · préfixe `\+`/);
  const perms = permissionsEmbed({ prefixes: { suckme: "=" } });
  assert.match(perms.description, /Modérateur test.*tempmute 2\/30 min/);
  assert.match(perms.description, /ban ⛔/);
  assert.match(perms.description, /`=pourquoi commande`/);
  assert.doesNotMatch(perms.description, /FWU/);
});

test("menu et boutons : la vue suit le composant, boutons seulement s'il y a plusieurs pages", () => {
  assert.deepEqual(helpViewFromInteraction({ customId: "aide:menu", values: ["permissions"] }), { section: "permissions", page: 0 });
  assert.deepEqual(helpViewFromInteraction({ customId: "aide:guard:1" }), { section: "guard", page: 1 });
  assert.equal(helpViewFromInteraction({ customId: "autre" }), null);
  assert.equal(helpPayload({ section: "guard" }, ctx).components.length, 2);
  assert.equal(helpPayload({ section: "fwu" }, ctx).components.length, 1);
  assert.equal(helpPayload({ section: "accueil" }, ctx).embeds[0].title, "📖 Aide · toutes les commandes");
});

test("tutoriels interactifs : choix, étapes, retour, recommencer et quitter", () => {
  assert.equal(Object.keys(HELP_TUTORIALS).length, 4);
  assert.ok(Object.values(HELP_TUTORIALS).every((tutorial) => tutorial.steps.length >= 3));
  assert.equal(HELP_TUTORIALS.troubleshoot.steps.length, 5);
  assert.match(HELP_TUTORIALS.troubleshoot.steps[3].content, /panneau de tickets existant/);
  const intro = tutorialPayload({ tutorialId: "permissions", page: -1, userId: "123456789012345678" }, ctx);
  assert.match(intro.embeds[0].title, /Comprendre les permissions/);
  assert.equal(intro.components.length, 3);
  const introButtons = intro.components[2].components.map((button) => button.data.custom_id);
  assert.ok(introButtons.some((id) => id.endsWith(":start:0")));
  assert.ok(introButtons.some((id) => id.endsWith(":quit:0")));

  const first = tutorialPayload({ tutorialId: "permissions", page: 0, userId: "123456789012345678" }, ctx);
  const firstButtons = first.components[2].components;
  assert.deepEqual(firstButtons.map((button) => button.data.label), ["Retour", "Suivant", "Recommencer", "Quitter"]);
  assert.equal(firstButtons[0].data.disabled, true);
  assert.equal(firstButtons[1].data.disabled, false);
  assert.ok(firstButtons.every((button) => button.data.custom_id.includes("123456789012345678")));

  const lastPage = HELP_TUTORIALS.permissions.steps.length - 1;
  const last = tutorialPayload({ tutorialId: "permissions", page: lastPage, userId: "123456789012345678" }, ctx);
  assert.equal(last.components[2].components[1].data.disabled, true);
  assert.equal(helpPayload({ section: "tutorials" }, ctx).embeds[0].title, "🧭 Tutoriels interactifs");
});

test("tutoriel : les boutons sont liés à l'utilisateur et pilotent la navigation", async () => {
  const parsed = helpViewFromInteraction({ customId: "aide:tutorial:123456789012345678:permissions:start:0" });
  assert.deepEqual(parsed, { section: "tutorials", ownerId: "123456789012345678", tutorialId: "permissions", action: "start", page: 0 });
  const calls = [];
  const allowed = {
    customId: "aide:tutorial:123456789012345678:permissions:next:1",
    user: { id: "123456789012345678" },
    update: async (payload) => calls.push(payload),
    reply: async () => assert.fail("authorized tutorial owner should update"),
  };
  assert.equal(await handleHelpComponent(allowed, ctx), true);
  assert.match(calls[0].embeds[0].title, /étape 2/);

  let refused = false;
  const denied = {
    ...allowed,
    user: { id: "999999999999999999" },
    update: async () => assert.fail("another user must not control this tutorial"),
    reply: async (payload) => { refused = /autre session/.test(payload.content); },
  };
  assert.equal(await handleHelpComponent(denied, ctx), true);
  assert.equal(refused, true);
});
