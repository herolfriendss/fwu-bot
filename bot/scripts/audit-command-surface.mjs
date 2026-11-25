import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DISCORD_MAX_ROOT_COMMANDS,
  SLASH_COMMANDS,
  EXTRA_SLASH_COMMANDS,
} from "../../src/lib/slash-commands.ts";
import {
  BOT_PROFILES,
  BOT_PROFILE_IDS,
  SHARED_SLASH_COMMANDS,
  SLASH_COMMAND_OWNERS,
  slashCommandNamesForProfile,
} from "../../src/lib/bot-profiles.ts";

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

/**
 * Audits the complete multi-application catalogue.
 * Discord's 100-root-command limit applies to each application, not to the
 * union of all commands owned by FWU's six independent bot applications.
 */
export function auditCommandSurface() {
  const definitions = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS];
  const definitionNames = definitions.map((command) => command.name);
  const known = new Set(definitionNames);
  const shared = [...SHARED_SLASH_COMMANDS];
  const owners = new Map();
  const duplicateOwnership = [];

  for (const profile of BOT_PROFILE_IDS) {
    for (const name of SLASH_COMMAND_OWNERS[profile] ?? []) {
      const previous = owners.get(name);
      if (previous) duplicateOwnership.push({ name, first: previous, second: profile });
      else owners.set(name, profile);
    }
  }

  const bots = BOT_PROFILE_IDS.map((id) => {
    const owned = [...(SLASH_COMMAND_OWNERS[id] ?? [])];
    const commands = slashCommandNamesForProfile(id);
    return {
      id,
      label: BOT_PROFILES[id].label,
      owned,
      commands,
      total: commands.length,
      withinLimit: commands.length <= DISCORD_MAX_ROOT_COMMANDS,
    };
  });

  const result = {
    valid:
      duplicates(definitionNames).length === 0 &&
      duplicateOwnership.length === 0 &&
      shared.every((name) => known.has(name)) &&
      [...owners.keys()].every((name) => known.has(name)) &&
      definitionNames.every((name) => owners.has(name) || shared.includes(name)) &&
      bots.every((bot) => bot.withinLimit),
    definitions: definitions.length,
    uniqueDefinitions: known.size,
    shared,
    duplicateDefinitions: duplicates(definitionNames),
    duplicateOwnership,
    unassigned: definitionNames.filter((name) => !owners.has(name) && !shared.includes(name)),
    missingDefinitions: [...owners.keys()].filter((name) => !known.has(name)),
    missingShared: shared.filter((name) => !known.has(name)),
    bots,
  };

  return result;
}

async function main() {
  const result = auditCommandSurface();
  const lines = [
    "# Audit du catalogue slash FWU",
    "",
    `- Applications Discord : **${result.bots.length}**.`,
    `- Définitions racine : **${result.uniqueDefinitions}** commandes uniques.`,
    `- Commandes communes à chaque application : **${result.shared.map((name) => `/${name}`).join(", ")}**.`,
    `- Doublons de définition : **${result.duplicateDefinitions.length}**.`,
    `- Commandes attribuées à plusieurs bots : **${result.duplicateOwnership.length}**.`,
    `- Commandes sans propriétaire : **${result.unassigned.length}**.`,
    "",
    "## Limite Discord par application",
    "",
    "| Application | Commandes propres | Communes | Total | Limite |",
    "|---|---:|---:|---:|---:|",
    ...result.bots.map((bot) =>
      `| ${bot.label} | ${bot.owned.length} | ${result.shared.length} | ${bot.total}/${DISCORD_MAX_ROOT_COMMANDS} | ${bot.withinLimit ? "OK" : "DÉPASSÉE"} |`,
    ),
    "",
  ];

  for (const bot of result.bots) {
    lines.push(
      `## ${bot.label}`,
      "",
      bot.owned.length ? bot.owned.map((name) => `- /${name}`).join("\n") : "- Aucune commande propre.",
      "",
    );
  }

  if (result.unassigned.length) lines.push("## Commandes sans propriétaire", "", result.unassigned.map((name) => `- /${name}`).join("\n"), "");
  if (result.missingDefinitions.length) lines.push("## Commandes attribuées mais absentes du catalogue", "", result.missingDefinitions.map((name) => `- /${name}`).join("\n"), "");
  if (result.missingShared.length) lines.push("## Commandes communes absentes du catalogue", "", result.missingShared.map((name) => `- /${name}`).join("\n"), "");

  const output = new URL("../../docs/architecture/PND_COMMAND_SURFACE_AUDIT.md", import.meta.url);
  await writeFile(output, lines.join("\n"));
  console.log(`Audit écrit : ${output.pathname}`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
