// Bout en bout : le vrai index.js de chaque bot démarre (Discord simulé) et doit
// répondre à SES commandes à préfixe, avec SON préfixe ; une commande tapée avec le
// préfixe d'un autre bot reçoit la bonne forme, de son seul bot propriétaire.
import assert from "node:assert/strict";
import test from "node:test";
import { runBotCommands } from "./scripts/prefix-e2e.mjs";

const answered = (results, command) => (results[command] ?? []).join("\n");

test("FDPDLAVOC répond à ;pv, ;panel, ;moveall, ;aide et corrige =pv", async () => {
  const r = await runBotCommands("fdpdlavoc", [";pv", ";unpv", ";panel", ";moveall", ";mv", ";aide", "=pv", "+panel", "=unpv"]);
  for (const command of [";pv", ";unpv", ";panel"]) assert.match(answered(r, command), /Rejoins le salon vocal/, command);
  assert.match(answered(r, ";moveall"), /mvall #vocal-cible/);
  assert.match(answered(r, ";mv"), /`;mv @membre`/, "l'aide montre le préfixe du bot, pas « = »");
  assert.match(answered(r, ";aide"), /Commandes de FDPDLAVOC/);
  assert.match(answered(r, "=pv"), /`;pv`/);
  assert.match(answered(r, "+panel"), /`;panel`/);
  assert.match(answered(r, "=unpv"), /`;unpv`/);
});

test("GUARD : +ban sans cible affiche l'aide, jamais « a été banni »", async () => {
  const r = await runBotCommands("guard", ["+ban", "+kick", "+aide", "=ban", ";pv"]);
  assert.match(answered(r, "+ban"), /Utilisation : `\+ban/);
  assert.doesNotMatch(answered(r, "+ban"), /banni\./);
  assert.match(answered(r, "+kick"), /Utilisation : `\+kick/);
  assert.match(answered(r, "+aide"), /Commandes de GUARD/);
  assert.match(answered(r, "=ban"), /`\+ban`/);
  assert.deepEqual(r[";pv"], [], "GUARD ne répond pas pour FDPDLAVOC");
});

test("SUCK ME, LE FISC et Invest + répondent avec leur préfixe", async () => {
  const s = await runBotCommands("suckme", ["=dog", "=aide", "=help", "=pv", "-dog"]);
  assert.match(answered(s, "=dog"), /`=dog @membre`/);
  assert.match(answered(s, "=aide"), /Commandes de SUCK ME/);
  assert.match(answered(s, "=help"), /Commandes de SUCK ME/);
  assert.deepEqual(s["=pv"], [], "=pv n'est pas une commande de SUCK ME");
  assert.match(answered(s, "-dog"), /`=dog`/);
  const f = await runBotCommands("fisc", ["-balance", "-aide", "=balance"]);
  assert.match(answered(f, "-balance"), /Solde/);
  assert.match(answered(f, "-aide"), /Commandes de LE FISC/);
  assert.match(answered(f, "=balance"), /`-balance`/);
  const i = await runBotCommands("investplus", ["$aide"]);
  assert.match(answered(i, "$aide"), /Commandes de Invest \+/);
});

test("le bot principal (slash uniquement) ignore tous les préfixes", async () => {
  const r = await runBotCommands("fwu", ["=pv", "+ban", "=aide", "-balance"]);
  for (const [command, replies] of Object.entries(r)) assert.deepEqual(replies, [], command);
});
