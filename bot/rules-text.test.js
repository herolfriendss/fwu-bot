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
