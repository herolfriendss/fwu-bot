import { ENTITLEMENT_PACKS, grantEntitlement, listEntitlements, revokeEntitlement } from "../../entitlements.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";

/**
 * Shared business flow for =pack and /pack. Both adapters call runPackAction, so
 * ownership checks, validation and audit exist in exactly one place.
 */
const STATUS_LABEL = { active: "actif", expired: "expiré", revoked: "révoqué" };

export async function runPackAction({ guildId, actorId, configuredOwners, action, pack, days, entitlementId, note, now = Date.now() }) {
  if (action === "grant") {
    const durationDays = days === null || days === undefined ? null : Number(days);
    const grant = grantEntitlement({ guildId, packKey: pack, actorId, durationDays, note, configuredOwners, now });
    const until = grant.expiresAt ? `jusqu'au <t:${Math.floor(grant.expiresAt / 1000)}:D>` : "sans expiration";
    return `✅ Pack **${grant.packKey}** attribué (#${grant.id}) ${until}.`;
  }
  if (action === "revoke") {
    const revoked = revokeEntitlement({ guildId, entitlementId: Number(entitlementId), actorId, configuredOwners, now });
    return `✅ Attribution #${revoked.id} du pack **${revoked.packKey}** révoquée. L'accès est retiré immédiatement.`;
  }
  if (action === "list") {
    const rows = listEntitlements(guildId, now, 20);
    if (!rows.length) return "Aucun pack attribué sur ce serveur.";
    return `**Packs du serveur**\n${rows.map((row) => `• #${row.id} · \`${row.packKey}\` · ${STATUS_LABEL[row.status]}${row.expiresAt && row.status === "active" ? ` · expire <t:${Math.floor(row.expiresAt / 1000)}:R>` : ""}`).join("\n")}`;
  }
  throw new Error("Action pack inconnue.");
}

/**
 * Prefix adapter, scoped under SYS+ so it never shares the card-pack command
 * (=pack opens card packs): =sysp pack grant <pack> <jours|permanent> [note]
 * · =sysp pack revoke <id> · =sysp pack list. `args` starts after "pack".
 */
export async function handlePackPrefix(message, args, { configuredOwners }) {
  const sub = (args[0] ?? "list").toLowerCase();
  try {
    let text;
    if (sub === "grant") {
      const pack = args[1];
      const rawDays = (args[2] ?? "permanent").toLowerCase();
      const days = rawDays === "permanent" ? null : Number(rawDays);
      if (rawDays !== "permanent" && !Number.isInteger(days)) throw new Error("Utilise `=sysp pack grant <pack> <jours|permanent> [note]`.");
      text = await runPackAction({ guildId: message.guild.id, actorId: message.author.id, configuredOwners, action: "grant", pack, days, note: args.slice(3).join(" ") || null });
    } else if (sub === "revoke") {
      text = await runPackAction({ guildId: message.guild.id, actorId: message.author.id, configuredOwners, action: "revoke", entitlementId: args[1] });
    } else if (sub === "list") {
      text = await runPackAction({ guildId: message.guild.id, actorId: message.author.id, configuredOwners, action: "list" });
    } else {
      throw new Error("Utilise `=sysp pack grant`, `=sysp pack revoke <id>` ou `=sysp pack list`.");
    }
    await message.reply({ content: text, allowedMentions: { parse: [] } });
  } catch (error) {
    await message.reply(`❌ ${error instanceof Error ? error.message : "Action pack impossible."}`);
  }
  return true;
}

/** Slash adapter for /pack grant|revoke|list, same flow as the prefix command. */
export async function handlePackInteraction(interaction, { configuredOwners }) {
  // Only /sysp pack is handled here; the card-pack root command /pack belongs to cards.
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "sysp") return false;
  if (interaction.options?.getSubcommand?.(false) !== "pack") return false;
  const guildId = interaction.guildId ?? interaction.guild?.id;
  if (!guildId) {
    await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
    return true;
  }
  try {
    const text = await runPackAction({
      guildId,
      actorId: interaction.user.id,
      configuredOwners,
      action: interaction.options.getString("action", true),
      pack: interaction.options.getString("pack"),
      days: interaction.options.getInteger("jours"),
      entitlementId: interaction.options.getInteger("id"),
      note: interaction.options.getString("note"),
    });
    await interaction.reply({ content: text, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Action pack impossible."}`, ephemeral: true });
  }
  return true;
}

export const PACK_CHOICES = ENTITLEMENT_PACKS.map((pack) => ({ name: pack, value: pack }));
