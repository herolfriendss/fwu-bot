import { createPndIntelligenceRateLimiter } from "./pnd-intelligence-rate-limit.js";
import { describePndAiFailure } from "./ai-error-messages.js";

const rateLimiter = createPndIntelligenceRateLimiter({ windowMs: 60_000, maxRequests: 3, maxKeys: 10_000 });
const noMentions = { parse: [] };

/**
 * Answers member questions from the public command catalogue and this guild's
 * public /knowledge pages. No conversation history, user profile, or private
 * server data is sent to the AI gateway.
 */
export async function handleHelpAssistantInteraction(interaction, { apiUrl, secret, commands = [], knowledge = [], fetchImpl = fetch } = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "ia") return false;
  if (interaction.options.getSubcommand() !== "question") return false;
  const guildId = interaction.guildId;
  const userId = interaction.user?.id;
  const question = String(interaction.options.getString("question", true) ?? "").trim().slice(0, 1000);
  if (!guildId || !userId || !question) {
    await interaction.reply({ content: "Cette aide doit être utilisée depuis un serveur avec une question.", ephemeral: true, allowedMentions: noMentions });
    return true;
  }
  if (!rateLimiter.take(`${guildId}:${userId}`)) {
    await interaction.reply({ content: "⏳ Tu as atteint la limite de 3 questions par minute. Réessaie dans un instant.", ephemeral: true, allowedMentions: noMentions });
    return true;
  }
  if (!apiUrl || !secret) {
    await interaction.reply({ content: "L'assistant IA n'est pas configuré pour le moment. Utilise `/aide` ou le panneau de support.", ephemeral: true, allowedMentions: noMentions });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        action: "ai-help-answer",
        prompt: question,
        guildId,
        commands: commands.slice(0, 250),
        knowledge: knowledge.slice(0, 6),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error(describePndAiFailure(response.status, data, "chat"));
    }
    await interaction.editReply({ content: data.reply.slice(0, 1900), allowedMentions: noMentions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "L'assistant est indisponible.";
    await interaction.editReply({ content: `⚠️ ${message} Utilise \`/aide\` ou le support si besoin.`, allowedMentions: noMentions }).catch(() => {});
  }
  return true;
}
