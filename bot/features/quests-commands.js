// /quete — today's three quests, their progress, and the reward button.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { applyBanner } from "../banners.js";
import { addXp } from "./community.js";
import { questBoard, claimQuests, questStreak, ALL_DONE_BONUS, QUESTS_PER_DAY } from "./quests.js";

export const QUEST_COMMANDS = new Set(["quete"]);
const pnd = (value) => `${Number(value ?? 0).toLocaleString("fr-FR")} PND`;

/** Ten segments, so progress reads at a glance on a phone. */
function bar(progress, goal) {
  const filled = Math.max(0, Math.min(10, Math.round((progress / goal) * 10)));
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}`;
}

function boardView(guildId, userId, username) {
  const board = questBoard(guildId, userId);
  const streak = questStreak(guildId, userId);
  const embed = new EmbedBuilder()
    .setColor(0xe21d2f)
    .setTitle(`🎯 Quêtes du jour — ${username}`)
    .setFooter({ text: `Nouvelles quêtes chaque jour · ${pnd(ALL_DONE_BONUS)} de bonus si tu fais les ${QUESTS_PER_DAY}` });

  for (const quest of board.quests) {
    const state = quest.claimed ? "✅ récupérée" : quest.done ? "🎁 à récupérer" : `${quest.progress} / ${quest.goal}`;
    embed.addFields({
      name: `${quest.emoji} ${quest.label}`,
      value: `${bar(quest.progress, quest.goal)} ${state}\nRécompense : **${pnd(quest.reward)}**${quest.xp ? ` + ${quest.xp} XP` : ""}`,
    });
  }
  if (board.bonusClaimed) embed.setDescription(`🔥 Journée complète. Série en cours : **${streak} jour(s)**.`);
  else if (board.allDone) embed.setDescription("🎁 Les trois quêtes sont faites : récupère le bonus.");
  else if (streak) embed.setDescription(`🔥 Série en cours : **${streak} jour(s)**. Termine les trois quêtes pour la garder.`);

  const claimable = board.claimable.length || (board.allDone && !board.bonusClaimed);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("quete:claim").setLabel(claimable ? "Récupérer" : "Rien à récupérer")
      .setStyle(claimable ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji("🎁").setDisabled(!claimable),
  );
  return { embeds: [applyBanner(embed, "jeux")], components: [row], flags: MessageFlags.Ephemeral };
}

export async function handleQuestInteraction(interaction) {
  try {
    const isButton = interaction.isButton?.() && interaction.customId === "quete:claim";
    if (!isButton && (!interaction.isChatInputCommand?.() || !QUEST_COMMANDS.has(interaction.commandName))) return false;
    if (!interaction.guildId) return false;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const username = interaction.member?.displayName ?? interaction.user.username;

    if (!isButton) {
      await interaction.reply(boardView(guildId, userId, username));
      return true;
    }

    const claim = claimQuests({ guildId, userId });
    if (claim.xp > 0) addXp(guildId, userId, claim.xp);
    await interaction.update(boardView(guildId, userId, username));
    if (claim.money > 0) {
      const lines = claim.paid.map((quest) => `${quest.emoji} ${quest.label} — ${pnd(quest.reward)}`);
      if (claim.bonus) lines.push(`🔥 Journée complète — ${pnd(ALL_DONE_BONUS)}`);
      await interaction.followUp({
        content: `🎁 **${pnd(claim.money)}**${claim.xp ? ` et ${claim.xp} XP` : ""} récupérés.\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Quêtes indisponibles."}`;
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
}
