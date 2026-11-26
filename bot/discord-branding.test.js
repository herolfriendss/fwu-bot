// Décision du 26/11/2026 (FWU V2) : aucun nom de produit « FWU » dans ce que Discord affiche
// (embeds, messages, raisons du journal d'audit, noms de salons créés, descriptions de commandes).
// Les identifiants internes (IS_FWU, PND_FWU_*, FWU_UPDATE_*…) et les commentaires restent libres.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const BOT = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(BOT, "..");

// Messages qui ne vont qu'à la console au démarrage (jamais dans Discord).
const CONSOLE_ONLY = new Set(["owner-config.js", "bot-runtime.js"]);

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", "data", "fixtures", "scripts"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

/** Texte des littéraux de chaîne (commentaires retirés) qui contient « FWU » hors identifiant. */
function brandedLiterals(code) {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const literals = withoutComments.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  return literals.filter((literal) => /(^|[^A-Z_])FWU(?![A-Z_])/.test(literal.replace(/\b[A-Z_]*FWU[A-Z_]+\b|\bIS_FWU\b/g, "")));
}

test("no Discord-facing bot text carries the FWU product name", () => {
  const offenders = [];
  for (const file of sources(BOT)) {
    const rel = relative(BOT, file);
    if (CONSOLE_ONLY.has(rel)) continue;
    for (const literal of brandedLiterals(readFileSync(file, "utf8"))) offenders.push(`${rel}: ${literal.slice(0, 80)}`);
  }
  assert.deepEqual(offenders, []);
});

test("slash command descriptions and bot labels never show FWU in Discord", () => {
  for (const file of ["src/lib/slash-commands.ts", "src/lib/bot-profiles.ts"]) {
    const code = readFileSync(join(ROOT, file), "utf8");
    for (const match of code.matchAll(/(?:description|label|summary)\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      assert.doesNotMatch(match[1], /\bFWU\b/, `${file} : ${match[1]}`);
    }
    for (const match of code.matchAll(/\bsub\(\s*"[^"]+"\s*,\s*("(?:[^"\\]|\\.)*")/g)) {
      assert.doesNotMatch(match[1], /\bFWU\b/, `${file} : ${match[1]}`);
    }
  }
});

test("bot signatures name only the bot (the main bot signs nothing)", async () => {
  const { themeFooterFrom } = await import("./theme.js");
  assert.equal(themeFooterFrom({}), "");
  assert.equal(themeFooterFrom({ PND_BOT_PROFILE: "guard" }), "GUARD");
  assert.equal(themeFooterFrom({ PND_BOT_PROFILE: "fisc" }), "LE FISC");
});
