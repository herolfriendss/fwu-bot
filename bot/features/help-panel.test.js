import test from "node:test";
import assert from "node:assert/strict";
import { HELP_PAGE_SIZE, botPageEmbed, commandsByBot, helpPayload, helpViewFromInteraction, overviewEmbed, permissionsEmbed } from "./help-panel.js";

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
