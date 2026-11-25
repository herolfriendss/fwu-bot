// /avantage — the shop where PND buy something in every bot.
import { EmbedBuilder, MessageFlags } from "discord.js";
import { applyBanner } from "../banners.js";
import { PERKS, activePerks, buyPerk, perkByKind, parseColour, applyColourRole } from "./perks.js";

export const PERK_COMMANDS = new Set(["avantage"]);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const pnd = (value) => `${Number(value ?? 0).toLocaleString("fr-FR")} PND`;
const days = (ms) => (ms >= 86_400_000 ? `${Math.round(ms / 86_400_000)} j` : `${Math.round(ms / 3_600_000)} h`);

export async function handlePerkInteraction(interaction) {
  try {
    if (!interaction.isChatInputCommand?.() || !PERK_COMMANDS.has(interaction.commandName)) return false;
    if (!interaction.guildId) return false;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (interaction.options.getSubcommand() === "liste") {
      const held = new Map(activePerks(guildId, userId).map((perk) => [perk.kind, perk]));
      const embed = applyBanner(new EmbedBuilder().setColor(0xe21d2f).setTitle("✨ Avantages")
        .setDescription("Tes PND servent dans les cinq bots. Racheter un avantage déjà actif prolonge sa durée."), "boutique");
      for (const perk of PERKS) {
        const mine = held.get(perk.kind);
        embed.addFields({
          name: `${perk.emoji} ${perk.label} — ${pnd(perk.price)}`,
          value: `${perk.description} · ${days(perk.durationMs)} · ${perk.bot}\n${mine ? `✅ actif jusqu'au <t:${Math.floor(mine.expiresAt / 1000)}:R>` : `\`/avantage acheter ${perk.kind}\``}`,
        });
      }
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return true;
    }

    if (interaction.options.getSubcommand() === "mes-avantages") {
      const mine = activePerks(guildId, userId);
      await interaction.reply(ephemeral(mine.length
        ? `✨ **Tes avantages actifs**\n${mine.map((perk) => `${perk.emoji} ${perk.label} — jusqu'au <t:${Math.floor(perk.expiresAt / 1000)}:R>`).join("\n")}`
        : "Aucun avantage actif. Regarde `/avantage liste`."));
      return true;
    }

    const kind = interaction.options.getString("avantage");
    const perk = perkByKind(kind);
    if (!perk) throw new Error("Cet avantage n'existe pas.");

    let payload = {};
    if (kind === "couleur") {
      const colour = parseColour(interaction.options.getString("couleur"));
      if (colour === null) throw new Error("Donne une couleur au format `#rrggbb`, par exemple `#e21d2f`.");
      payload = { colour };
    }

    const result = buyPerk({ guildId, userId, kind, payload });
    // The role can fail without the purchase failing, so it becomes a notice
    // inside the single confirmation rather than a second reply.
    const roleProblem = kind === "couleur"
      ? await applyColourRole(interaction.member, payload.colour).then(() => null, (error) => error?.message ?? "rôle impossible")
      : null;
    await interaction.reply(ephemeral([
      `${perk.emoji} **${perk.label}** ${result.extended ? "prolongé" : "activé"} jusqu'au <t:${Math.floor(result.expiresAt / 1000)}:F>.`,
      `${pnd(result.spent)} dépensés.`,
      roleProblem ? `⚠️ La couleur n'a pas pu être appliquée : ${roleProblem}. Préviens le staff, l'avantage reste actif.` : "",
    ].filter(Boolean).join("\n")));
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Achat impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [] }).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
    return true;
  }
}
