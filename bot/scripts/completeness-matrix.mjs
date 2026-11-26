// FWU V2 — matrice de complétude bot × commande (slash, préfixe, aide, /setup, logs typés, tests).
// Usage : node --experimental-strip-types --no-warnings bot/scripts/completeness-matrix.mjs > docs/V2_COMPLETUDE.md
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const BOT = fileURLToPath(new URL("..", import.meta.url));
const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../../src/lib/slash-commands.ts");
const profiles = await import("../../src/lib/bot-profiles.ts");
const catalogue = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS];

const sources = [];
const tests = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "data", "fixtures", "scripts"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".test.js")) tests.push(readFileSync(path, "utf8"));
    else if (name.endsWith(".js")) sources.push({ rel: relative(BOT, path), code: readFileSync(path, "utf8") });
  }
})(BOT);
const setupCode = sources.filter((s) => s.rel.startsWith("systems/setup/")).map((s) => s.code).join("\n");
const testCode = tests.join("\n");

function handlerFiles(name) {
  const patterns = [`commandName === "${name}"`, `commandName !== "${name}"`, `"${name}"`];
  return sources.filter((s) => s.rel !== "index.js" && patterns.some((p) => s.code.includes(p)) && /commandName|_COMMANDS|options\.getSubcommand/.test(s.code));
}

const rows = [];
for (const bot of profiles.BOT_PROFILE_IDS) {
  for (const name of profiles.SLASH_COMMAND_OWNERS[bot]) {
    const def = catalogue.find((c) => c.name === name);
    const files = handlerFiles(name);
    const prefix = bot === "fwu" ? "—" : profiles.PREFIX_COMMAND_OWNERS[bot].includes(name) ? "dédié" : "pont";
    rows.push({
      bot, name,
      slash: def ? "✅" : "❌",
      prefix: prefix === "—" ? "— (slash seul)" : `✅ ${prefix}`,
      help: def?.description ? "✅" : "❌",
      setup: setupCode.includes(`"${name}"`) || setupCode.includes(`/${name}`) ? "✅" : "▫️",
      logs: files.some((f) => /logEvent\(|category:|logCategory|sendCentralLog\(/.test(f.code)) ? "✅" : "▫️",
      tests: testCode.includes(`"${name}"`) || testCode.includes(`/${name} `) || testCode.includes(`=${name}`) ? "✅" : "▫️",
    });
  }
}

const count = (key, bot) => rows.filter((r) => r.bot === bot && r[key].startsWith("✅")).length;
const out = [
  "# FWU V2 — matrice de complétude",
  "",
  "Générée par `node --experimental-strip-types --no-warnings bot/scripts/completeness-matrix.mjs`. Ne pas éditer à la main.",
  "",
  "Légende : ✅ présent · ▫️ absent ou non détecté · « pont » = la commande slash répond avec le préfixe du bot via `prefix-slash-bridge.js`.",
  "Aide : toute commande du catalogue apparaît dans `/aide` et dans le guide. `/setup` : la commande a un réglage dans le panneau de configuration.",
  "Logs typés : le module qui la traite journalise avec une catégorie. Tests : la commande est citée dans un test.",
  "",
  "## Résumé par bot",
  "",
  "| Bot | Commandes | Préfixe | Aide | /setup | Logs typés | Tests |",
  "|---|---|---|---|---|---|---|",
  ...profiles.BOT_PROFILE_IDS.map((bot) => {
    const n = rows.filter((r) => r.bot === bot).length;
    return `| ${profiles.BOT_PROFILES[bot].label} | ${n} | ${bot === "fwu" ? "slash seul (décision 21)" : `${count("prefix", bot)}/${n}`} | ${count("help", bot)}/${n} | ${count("setup", bot)}/${n} | ${count("logs", bot)}/${n} | ${count("tests", bot)}/${n} |`;
  }),
  "",
  "## Détail",
  "",
  "| Bot | Commande | Slash | Préfixe | Aide | /setup | Logs typés | Tests |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${profiles.BOT_PROFILES[r.bot].label} | \`/${r.name}\` | ${r.slash} | ${r.prefix} | ${r.help} | ${r.setup} | ${r.logs} | ${r.tests} |`),
  "",
];
console.log(out.join("\n"));
