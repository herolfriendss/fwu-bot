import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_PREFIXES, PREFIX_COMMAND_OWNERS, botsConfigPath, loadBotPrefixes, parsePrefixedMessage, validatePrefixes } from "./bot-runtime.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SLASH_FOR_PREFIX, prefixifyPayload, prefixifyText, slashifyPayload, slashifyText } from "./prefix-to-slash.js";

const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");



function pathExists(path) {
  const [root, ...rest] = path.split(" ");
  let node = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS].find((command) => command.name === root);
  for (const part of rest) node = node?.options?.find((option) => option.name === part && option.type <= 2);
  return Boolean(node);
}

// Commandes qui n'existent qu'en préfixe (décision du 24/11 : +unban sur GUARD, ;mv et ;accessall sur FDPDLAVOC).
const PREFIX_ONLY = ["unban", "mv", "accessall"];

test("every prefix command has a slash equivalent, except the documented prefix-only ones", () => {
  const tokens = Object.values(PREFIX_COMMAND_OWNERS).flat();
  const missing = tokens.filter((token) => !SLASH_FOR_PREFIX[token]);
  assert.deepEqual(missing.sort(), [...PREFIX_ONLY].sort(), "commande préfixe sans équivalent slash déclaré");
  const broken = Object.entries(SLASH_FOR_PREFIX).filter(([, path]) => !pathExists(path)).map(([token, path]) => `${token} → /${path}`);
  assert.deepEqual(broken, [], "chemin slash introuvable dans le catalogue");
});

test("each bot reads its own prefix (FWU: slash only) and a command answers on its owning bot only", () => {
  const prefixes = loadBotPrefixes({});
  const example = JSON.parse(readFileSync(new URL("./config/bots.example.json", import.meta.url), "utf8"));
  assert.deepEqual(validatePrefixes(example.prefixes), prefixes, "le fichier d'exemple livré est valide et identique aux défauts");
  assert.deepEqual(prefixes, { fwu: null, guard: "+", fdpdlavoc: ";", suckme: "=", fisc: "-", investplus: "$" });
  assert.equal(parsePrefixedMessage("$abo", prefixes).owner, "investplus");
  assert.equal(parsePrefixedMessage("$100 pour moi", prefixes), null, "un montant n'est pas une commande");
  assert.deepEqual(parsePrefixedMessage("+ban 123456789012345678 spam", prefixes), { owner: "guard", prefix: "+", word: "ban", canonical: "=ban 123456789012345678 spam" });
  assert.equal(parsePrefixedMessage(";mv <@123456789012345678>", prefixes).owner, "fdpdlavoc");
  assert.equal(parsePrefixedMessage("-dice", prefixes).owner, "fisc");
  assert.equal(parsePrefixedMessage("=afk on", prefixes).owner, "suckme");
  // A command typed with another bot's prefix exists nowhere: no fallback.
  assert.equal(parsePrefixedMessage("=ban 1", prefixes), null, "=ban n'existe pas : le ban est sur GUARD (+)");
  assert.equal(parsePrefixedMessage("+play", prefixes), null);
  assert.equal(parsePrefixedMessage("-_-", prefixes), null, "un smiley n'est pas une commande");
  assert.equal(parsePrefixedMessage("; salut", prefixes), null);
  assert.throws(() => validatePrefixes({ ...DEFAULT_PREFIXES, fwu: "!" }), /slash uniquement/);
  assert.throws(() => validatePrefixes({ ...DEFAULT_PREFIXES, fisc: "+" }), /conflit/);
  assert.throws(() => validatePrefixes({ ...DEFAULT_PREFIXES, fisc: "++" }), /conflit/, "« ++ » commence comme « + »");
  assert.throws(() => validatePrefixes({ ...DEFAULT_PREFIXES, guard: "a" }), /invalide/);
  assert.throws(() => validatePrefixes({ ...DEFAULT_PREFIXES, guard: "/" }), /invalide/);
  assert.deepEqual(validatePrefixes({ ...DEFAULT_PREFIXES, guard: "!" }).guard, "!");
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /const runCmd = \(\.\.\.domains\) => ownCommand && domains\.includes\(RUNTIME\.profile\)/);
  assert.match(source, /if \(owner && owner !== RUNTIME\.profile\)/, "une commande slash n'est traitée que par son bot");
  assert.doesNotMatch(source, /PND_PREFIX_COMMANDS/);
});

test("the 5 bots read one shared prefix file (PND_DATA_DIR/bots.json)", () => {
  const shared = mkdtempSync(join(tmpdir(), "fwu-prefixes-"));
  assert.match(botsConfigPath({ PND_DATA_DIR: shared }), /config\/bots\.json$/, "sans fichier partagé : bot/config/bots.json");
  writeFileSync(join(shared, "bots.json"), JSON.stringify({ prefixes: { ...DEFAULT_PREFIXES, guard: "!" } }));
  assert.equal(botsConfigPath({ PND_DATA_DIR: shared }), join(shared, "bots.json"));
  assert.equal(loadBotPrefixes({ PND_DATA_DIR: shared }).guard, "!");
  writeFileSync(join(shared, "bots.json"), "{ cassé");
  assert.throws(() => loadBotPrefixes({ PND_DATA_DIR: shared }), /JSON valide/);
  assert.equal(botsConfigPath({ PND_BOTS_CONFIG: "/x/y.json", PND_DATA_DIR: shared }), "/x/y.json");
});

test("replies of a prefix command show the bot's own prefix", () => {
  assert.equal(prefixifyText("Utilise `=mv @membre`.", ";"), "Utilise `;mv @membre`.");
  assert.equal(prefixifyText("`=ban ID`", "+"), "`+ban ID`");
  assert.equal(prefixifyText("`=afk on`", "="), "`=afk on`");
  assert.deepEqual(prefixifyPayload({ content: "`=play x`", embeds: [{ description: "`=skip`" }] }, ";"), { content: "`;play x`", embeds: [{ description: "`;skip`" }] });
});

test("help texts written for = are translated into slash commands", () => {
  assert.equal(slashifyText("Utilise `=ticket help`."), "Utilise `/ticket help`.");
  assert.equal(slashifyText("`=unpv` puis `=pv liste`"), "`/voice private retirer` puis `/voice private liste`");
  assert.equal(slashifyText("`=pv`"), "`/voice private activer`");
  assert.equal(slashifyText("`=access @membre`"), "`/voice access grant @membre`");
  assert.equal(slashifyText("`=unaccess @membre`"), "`/voice access revoke @membre`");
  assert.equal(slashifyText("`=rep @membre [raison]`"), "`/rep donner @membre [raison]`");
  assert.equal(slashifyText("`=rephistorique @B`"), "`/rep historique @B`");
  assert.equal(slashifyText("`=pndia crée un rôle`"), "`/ia demande crée un rôle`");
  assert.equal(slashifyText("`=casino roulette 10 rouge`"), "`/casino roulette 10 rouge`");
  assert.equal(slashifyText("`=play daft punk`"), "`/music player play daft punk`");
  assert.equal(slashifyText("`=musicpanel`"), "`/music player panel`");
  assert.equal(slashifyText("`=inconnu`"), "`=inconnu`", "une commande personnalisée reste intacte");
  assert.equal(slashifyText("rien à changer"), "rien à changer");
  const payload = slashifyPayload({ content: "`=afk off`", embeds: [{ description: "`=guardian-review list`", fields: [{ name: "x", value: "`=solde`" }] }] });
  assert.equal(payload.content, "`/afk off`");
  assert.equal(payload.embeds[0].description, "`/guildguard review`");
  assert.equal(slashifyText("`=guardian-review resolve 4 cleared`"), "`/guildguard resolve 4 cleared`");
  assert.equal(payload.embeds[0].fields[0].value, "`/balance`");
});
