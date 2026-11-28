import test from "node:test";
import assert from "node:assert/strict";
import { parseRulesText, rulesToText, validateRules } from "./rules-ai.js";

test("règlement écrit à la main : une règle par ligne, numéros et puces ignorés", () => {
  const rules = parseRulesText("1. Respect : pas d'insulte.\n\n2) Publicité - interdite sans accord\n• **Vocal** — pas de cris\n  ni de soundboard\nSpam : non.\nVie privée : rien de perso.");
  assert.deepEqual(rules.map((r) => r.title), ["Respect", "Publicité", "Vocal", "Spam", "Vie privée"]);
  assert.equal(rules[2].description, "pas de cris ni de soundboard");
  assert.equal(validateRules(rules).ok, true);
});

test("aller-retour texte ↔ règles, ligne sans titre refusée", () => {
  const rules = [{ title: "Respect", description: "Pas d'insulte : jamais." }, { title: "Spam", description: "Non." }];
  assert.deepEqual(parseRulesText(rulesToText(rules)), rules);
  assert.throws(() => parseRulesText("juste une phrase sans séparateur"), /Titre : description/);
  assert.deepEqual(parseRulesText(""), []);
});


test("règlement IA : utilise la passerelle FWU et ne demande aucune clé fournisseur au bot", async () => {
  const rules = [
    { title: "Respect", description: "Échange avec respect et sans harcèlement." },
    { title: "Vie privée", description: "Ne diffuse aucune information personnelle." },
    { title: "Spam", description: "Évite les messages répétitifs et la publicité non autorisée." },
    { title: "Vocal", description: "Respecte le calme et les échanges dans les salons vocaux." },
    { title: "Sécurité", description: "Ne partage aucun lien malveillant ou fichier dangereux." },
  ];
  let request;
  const generated = await (await import("./rules-ai.js")).generateRules({
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "100000000000000001",
    userId: "200000000000000002",
    guildName: "FWU",
    count: 5,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ rules }) };
    },
  });
  assert.deepEqual(generated, rules);
  assert.equal(request.url, "https://fwu.example/api/public/bot-sync");
  assert.equal(request.options.headers.Authorization, "Bearer bot-sync-secret");
  const body = JSON.parse(request.options.body);
  assert.equal(body.action, "ai-rules");
  assert.equal(body.guildId, "100000000000000001");
  assert.equal(body.userId, "200000000000000002");
  assert.equal(body.count, 5);
});

test("règlement IA : signale clairement l'absence de passerelle ou de budget", async () => {
  const { generateRules } = await import("./rules-ai.js");
  await assert.rejects(generateRules({}), /passerelle IA centrale n'est pas configurée/i);
  await assert.rejects(generateRules({
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "100000000000000001",
    userId: "200000000000000002",
    guildName: "FWU",
    count: 5,
    fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({ error: "credits" }) }),
  }), /budget IA/i);
});
