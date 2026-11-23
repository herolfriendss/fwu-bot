import {
  installExtension, listCatalog, listInstalled, marketplaceEnabled, publishCatalogEntry, reviewVersion,
  rollbackExtension, submitVersion, uninstallExtension, withdrawCatalogEntry,
} from "../../marketplace.js";
import { activeEntitlementKeys } from "../../entitlements.js";
import { isSysPlus } from "../sysplus/permissions.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";

const OWNER_ACTIONS = new Set(["publish", "withdraw", "submit", "validate", "reject"]);

/** Single business flow for the Marketplace. Only the prefix adapter exists for now; see report. */
export async function runMarketAction({ guild, member, actorId, roleId, configuredOwners, action, args }) {
  if (!marketplaceEnabled()) return "⛔ Le Marketplace est désactivé sur cette instance.";
  const guildId = guild.id;
  if (action === "catalog") {
    const rows = listCatalog();
    return rows.length ? `**Catalogue PND**\n${rows.map((r) => `• \`${r.extension_id}\` — **${r.name}** · ${r.summary}`).join("\n")}` : "Catalogue vide.";
  }
  if (action === "installed") {
    const rows = listInstalled(guildId);
    return rows.length ? rows.map((r) => `• \`${r.extensionId}\` ${r.version} · permissions : ${r.permissions.join(", ") || "aucune"}`).join("\n") : "Aucune extension installée.";
  }
  if (OWNER_ACTIONS.has(action)) {
    if (action === "publish") {
      const [id, name, summary] = args;
      publishCatalogEntry({ guildId, actorId, configuredOwners, id, name, summary });
      return `✅ \`${id}\` ajouté au catalogue (listé).`;
    }
    if (action === "withdraw") {
      withdrawCatalogEntry({ guildId, actorId, configuredOwners, id: args[0] });
      return `✅ \`${args[0]}\` retiré du catalogue. Aucune nouvelle installation possible.`;
    }
    if (action === "submit") {
      const result = submitVersion({ guildId, actorId, configuredOwners, extensionId: args[0], manifest: args.slice(1).join(" ") });
      return `📝 \`${result.extensionId}@${result.version}\` soumis à revue (empreinte ${result.sha256.slice(0, 12)}).`;
    }
    const decision = action === "validate" ? "validate" : "reject";
    const result = reviewVersion({ guildId, actorId, configuredOwners, extensionId: args[0], version: args[1], decision });
    const label = result.status === "validated" ? "validée" : "rejetée";
    return `✅ \`${result.extensionId}@${result.version}\` ${label}.`;
  }
  // SYS+ actions below: install, uninstall, rollback, all with consent.
  const tiers = isSysPlus(member, roleId) ? ["SYS_PLUS"] : [];
  const entitlements = activeEntitlementKeys(guildId);
  const common = { guildId, actorId, tiers, entitlements };
  if (action === "install") {
    const [extensionId, version, confirm] = args;
    const result = installExtension({ ...common, extensionId, version, confirmed: confirm === "confirmer" });
    if (result.code === "CONSENT_REQUIRED") {
      const list = result.consent.map((c) => `• \`${c.key}\` — ${c.label}`).join("\n") || "• aucune permission";
      return `🔒 **${result.name}** ${result.version} demande :\n${list}\nPour accepter : \`=sysp market install ${extensionId} ${version} confirmer\``;
    }
    return result.ok ? `✅ \`${extensionId}\` ${result.version} installé.` : `⛔ Installation refusée : ${result.code}`;
  }
  if (action === "uninstall") {
    const result = uninstallExtension({ ...common, extensionId: args[0] });
    return result.ok ? `✅ \`${args[0]}\` désinstallé (historique conservé).` : `⛔ ${result.code}`;
  }
  if (action === "rollback") {
    const result = rollbackExtension({ ...common, extensionId: args[0] });
    return result.ok ? `↩️ \`${args[0]}\` revenu à la version ${result.version}.` : `⛔ Retour arrière refusé : ${result.code}`;
  }
  throw new Error("Action Marketplace inconnue.");
}

/** Prefix adapter: =sysp market <action> … ; the slash command is blocked by Discord's command limits. */
export async function handleMarketPrefix(message, args, { roleId, configuredOwners }) {
  const action = (args[0] ?? "catalog").toLowerCase();
  try {
    const text = await runMarketAction({
      guild: message.guild, member: message.member, actorId: message.author.id, roleId, configuredOwners,
      action, args: args.slice(1),
    });
    await message.reply({ content: text, allowedMentions: { parse: [] } });
  } catch (error) {
    await message.reply(`❌ ${error instanceof Error ? error.message : "Action Marketplace impossible."}`);
  }
  return true;
}

/**
 * Slash adapter for /sysp market <sub>. Routed by subcommand group, so the
 * SYS+ handler never sees these. Same business flow as the prefix adapter.
 */
export async function handleMarketInteraction(interaction, { roleId, configuredOwners }) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "sysp") return false;
  if (interaction.options?.getSubcommandGroup?.(false) !== "market") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
    return true;
  }
  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "❌ Impossible d’actualiser ton profil serveur. Réessaie.", ephemeral: true });
    return true;
  }
  const o = interaction.options;
  const action = o.getSubcommand();
  const id = o.getString("id");
  const argsFor = {
    catalog: [],
    installed: [],
    publish: [id, o.getString("nom"), o.getString("resume") ?? ""],
    withdraw: [id],
    submit: [id, o.getString("manifeste")],
    validate: [id, o.getString("version")],
    reject: [id, o.getString("version")],
    install: [id, o.getString("version"), o.getBoolean("confirmer") ? "confirmer" : undefined],
    uninstall: [id],
    rollback: [id],
  };
  if (!Object.hasOwn(argsFor, action)) {
    await interaction.reply({ content: "Action Marketplace inconnue.", ephemeral: true });
    return true;
  }
  try {
    const text = await runMarketAction({
      guild, member, actorId: interaction.user.id, roleId, configuredOwners, action, args: argsFor[action].filter((v) => v !== undefined),
    });
    await interaction.reply({ content: text, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Action Marketplace impossible."}`, ephemeral: true });
  }
  return true;
}
