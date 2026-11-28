// Centre d'aide 4.1 — documentation des commandes générée depuis leurs vraies définitions
// (src/lib/slash-commands.ts + src/lib/bot-profiles.ts). Jamais écrite à la main : une commande
// ajoutée, renommée ou retirée met la page à jour, et la CI vérifie qu'elle est à jour.
//
//   node --experimental-strip-types bot/scripts/generate-command-docs.mjs          → écrit docs/COMMANDES.md
//   node --experimental-strip-types bot/scripts/generate-command-docs.mjs --check  → échoue si elle est périmée
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EXTRA_SLASH_COMMANDS, SLASH_COMMANDS } from "../../src/lib/slash-commands.ts";
import { BOT_PROFILE_IDS, BOT_PROFILES, DEFAULT_PREFIXES, SHARED_SLASH_COMMANDS, slashCommandNamesForProfile } from "../../src/lib/bot-profiles.ts";

const TYPE = { 3: "texte", 4: "nombre entier", 5: "oui/non", 6: "membre", 7: "salon", 8: "rôle", 9: "membre ou rôle", 10: "nombre", 11: "fichier" };
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function optionLine(o) {
  const bits = [TYPE[o.type] ?? "valeur", o.required ? "obligatoire" : "facultatif"];
  if (o.choices?.length) bits.push(`choix : ${o.choices.map((c) => c.name).join(", ")}`);
  if (o.max_length) bits.push(`${o.max_length} caractères max`);
  return `\`${o.name}\` (${bits.join(", ")}) — ${clean(o.description)}`;
}

function subcommandLines(def, prefix) {
  const out = [];
  const walk = (options, path) => {
    for (const o of options ?? []) {
      if (o.type === 2) walk(o.options, [...path, o.name]);
      else if (o.type === 1) {
        const params = (o.options ?? []).map(optionLine);
        out.push(`- \`/${[def.name, ...path, o.name].join(" ")}\` — ${clean(o.description)}${prefix ? ` · préfixe \`${prefix}${[def.name, ...path, o.name].join(" ")}\`` : ""}${params.length ? `<br>${params.join("<br>")}` : ""}`);
      }
    }
  };
  walk(def.options, []);
  return out;
}

export function renderCommandDocs() {
  const catalogue = new Map([...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS].map((c) => [c.name, c]));
  const lines = [
    "# Commandes des bots (générée automatiquement)",
    "",
    "> Ne pas modifier à la main : `node --experimental-strip-types bot/scripts/generate-command-docs.mjs`.",
    "> Source : `src/lib/slash-commands.ts` (définitions) et `src/lib/bot-profiles.ts` (bot qui porte chaque commande).",
    "> La plupart des commandes existent aussi avec le préfixe du bot (ex. `=staff centre`). Les commandes sans préfixe sont disponibles uniquement en slash.",
    "",
    `Commandes communes à tous les bots : ${SHARED_SLASH_COMMANDS.map((n) => `\`/${n}\``).join(", ")}.`,
    "",
  ];
  for (const id of BOT_PROFILE_IDS) {
    const profile = BOT_PROFILES[id];
    const prefix = DEFAULT_PREFIXES[id] ?? null;
    const names = slashCommandNamesForProfile(id).filter((n) => !SHARED_SLASH_COMMANDS.includes(n)).sort();
    lines.push(`## ${profile.label}${prefix ? ` (préfixe \`${prefix}\`)` : ""}`, "", clean(profile.summary ?? ""), "", `${names.length} commandes.`, "");
    for (const name of names) {
      const def = catalogue.get(name);
      if (!def) continue;
      const subs = subcommandLines(def, def.prefixEnabled === false ? null : prefix);
      const params = subs.length ? [] : (def.options ?? []).map(optionLine);
      lines.push(`### /${def.name}`, "", `${clean(def.description)}  `, `Catégorie : ${clean(def.category)} · Utilisation : \`${clean(def.usage)}\``, "");
      if (subs.length) lines.push(...subs, "");
      else if (params.length) lines.push(...params.map((p) => `- ${p}`), "");
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function main() {
  const target = new URL("../../docs/COMMANDES.md", import.meta.url);
  const text = renderCommandDocs();
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== text) { console.error("docs/COMMANDES.md est périmée : relance bot/scripts/generate-command-docs.mjs"); process.exit(1); }
    console.log("docs/COMMANDES.md à jour.");
    return;
  }
  await writeFile(target, text);
  console.log(`docs/COMMANDES.md écrite (${text.length} caractères).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
