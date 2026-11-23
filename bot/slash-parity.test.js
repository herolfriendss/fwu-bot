import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PREFIX_COMMAND_OWNERS } from "./bot-runtime.js";
import { SLASH_FOR_PREFIX, slashifyPayload, slashifyText } from "./prefix-to-slash.js";

const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");



function pathExists(path) {
  const [root, ...rest] = path.split(" ");
  let node = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS].find((command) => command.name === root);
  for (const part of rest) node = node?.options?.find((option) => option.name === part && option.type <= 2);
  return Boolean(node);
}

test("every former = command has a slash equivalent", () => {
  const tokens = Object.values(PREFIX_COMMAND_OWNERS).flat();
  const missing = tokens.filter((token) => !SLASH_FOR_PREFIX[token]);
  assert.deepEqual(missing, [], "commande = sans équivalent slash déclaré");
  const broken = Object.entries(SLASH_FOR_PREFIX).filter(([, path]) => !pathExists(path)).map(([token, path]) => `${token} → /${path}`);
  assert.deepEqual(broken, [], "chemin slash introuvable dans le catalogue");
});

test("= commands are off unless explicitly re-enabled", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /PREFIX_COMMANDS_ENABLED = String\(process\.env\.PND_PREFIX_COMMANDS \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "on"/);
  assert.match(source, /const runCmd = \(domain\) => !prefixBlocked && /);
  assert.match(source, /const command = prefixBlocked \? null : resolvePrefixCommand/);
});

test("help texts written for = are translated into slash commands", () => {
  assert.equal(slashifyText("Utilise `=ticket help`."), "Utilise `/ticket help`.");
  assert.equal(slashifyText("`=unpv` puis `=pv liste`"), "`/pv retirer` puis `/pv liste`");
  assert.equal(slashifyText("`=pv`"), "`/pv activer`");
  assert.equal(slashifyText("`=rep @membre [raison]`"), "`/rep donner @membre [raison]`");
  assert.equal(slashifyText("`=rephistorique @B`"), "`/rep historique @B`");
  assert.equal(slashifyText("`=pndia crée un rôle`"), "`/ia demande crée un rôle`");
  assert.equal(slashifyText("`=casino roulette 10 rouge`"), "`/casino roulette 10 rouge`");
  assert.equal(slashifyText("`=inconnu`"), "`=inconnu`", "une commande personnalisée reste intacte");
  assert.equal(slashifyText("rien à changer"), "rien à changer");
  const payload = slashifyPayload({ content: "`=afk off`", embeds: [{ description: "`=guardian-review list`", fields: [{ name: "x", value: "`=solde`" }] }] });
  assert.equal(payload.content, "`/afk off`");
  assert.equal(payload.embeds[0].description, "`/guildguard review`");
  assert.equal(slashifyText("`=guardian-review resolve 4 cleared`"), "`/guildguard resolve 4 cleared`");
  assert.equal(payload.embeds[0].fields[0].value, "`/balance`");
});
