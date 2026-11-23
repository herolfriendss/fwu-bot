import { writeFile } from "node:fs/promises";
import { SLASH_COMMANDS } from "../../src/lib/slash-commands.ts";

// 1942 runs as a single bot on a single Discord application: the catalogue must fit
// the 100 root-command slots and contain no duplicate name.
const names = SLASH_COMMANDS.map((command) => command.name);
const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
const total = names.length;
const valid = duplicates.length === 0 && total <= 100;
const categories = Object.groupBy(SLASH_COMMANDS, (command) => command.category);

const lines = [
  "# Audit du catalogue slash 1942",
  "",
  `- Commandes racine : **${total}/100**.`,
  `- Doublons : **${duplicates.length}**.`,
  "- Architecture : un seul bot, une seule application Discord.",
  "",
  "## Répartition par catégorie",
  "",
];
for (const [category, commands] of Object.entries(categories)) lines.push(`- **${category}** : ${commands.length}`);
lines.push("", "## Commandes par catégorie", "");
for (const [category, commands] of Object.entries(categories)) {
  lines.push(`### ${category} — ${commands.length}`);
  lines.push(commands.map((command) => `- /${command.name}`).join("\n"));
  lines.push("");
}
lines.push("## Limites", "", "- Le catalogue utilise les emplacements de commandes racine Discord disponibles (maximum 100) : toute nouvelle commande doit devenir une sous-commande d'une commande existante ou en remplacer une.", "");
const output = new URL("../../docs/architecture/PND_COMMAND_SURFACE_AUDIT.md", import.meta.url);
await writeFile(output, lines.join("\n"));
console.log(`Audit écrit : ${output.pathname}`);
console.log(JSON.stringify({ valid, total, duplicates }, null, 2));
if (!valid) process.exitCode = 1;
