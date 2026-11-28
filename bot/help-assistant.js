import { createPndIntelligenceRateLimiter } from "./pnd-intelligence-rate-limit.js";
import { describePndAiFailure } from "./ai-error-messages.js";

const rateLimiter = createPndIntelligenceRateLimiter({ windowMs: 60_000, maxRequests: 3, maxKeys: 10_000 });
const noMentions = { parse: [] };

const SECRET_INPUT = /(?:mfa\\.[A-Za-z0-9_-]{40,}|[A-Za-z0-9_-]{24}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{20,}|(?:api[_ -]?key|access[_ -]?token|bot[_ -]?token|password|mot de passe|secret|token)\\s*[:=]\\s*\\S{8,}|Bearer\\s+[A-Za-z0-9._-]{16,}|sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/i;

export function containsSecretInput(value) {
  return SECRET_INPUT.test(String(value ?? ""));
}

export function redactPrivateText(value) {
  return String(value ?? "")
    .replace(/<@!?\\d{17,20}>/g, "@membre")
    .replace(/<@&\\d{17,20}>/g, "@rôle")
    .replace(/<#\\d{17,20}>/g, "#salon")
    .replace(/\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi, "[adresse e-mail masquée]")
    .replace(/\\b\\d{17,20}\\b/g, "[identifiant masqué]")
    .replace(/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/g, "[adresse IP masquée]")
    .replace(/\\+?\\d[\\d\\s().-]{7,}\\d/g, "[numéro masqué]");
}

/** Reject command syntax that is not present in the authoritative slash catalogue. */
export function hasUnknownCommandReference(reply, commands = []) {
  const mentions = String(reply ?? "").matchAll(/(?:^|[\s(`])([/=+;!$-][a-z0-9_-]+(?:\s+[a-z0-9_-]+){0,2})/gi);
  for (const match of mentions) {
    const [token, ...parts] = match[1].trim().split(/\s+/);
    const prefix = token[0];
    const name = token.slice(1).toLowerCase();
    const command = commands.find((entry) => String(entry.name).toLowerCase() === name);
    if (!command) return true;
    if (prefix !== "/" && String(command.prefix ?? "/") !== prefix) return true;
    const paths = Array.isArray(command.paths) ? command.paths : [name];
    const subcommandPaths = paths.map((path) => String(path).split(" ").slice(1)).filter((path) => path.length);
    if (parts.length && subcommandPaths.length) {
      const firstExtra = parts[0];
      if (firstExtra.includes(":") || firstExtra.startsWith("@") || firstExtra.startsWith("<") || firstExtra.startsWith("#")) continue;
      const valid = subcommandPaths.some((path) => path.every((part, index) => parts[index] === part));
      if (!valid) return true;
    }
  }
  return false;
}

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
  const rawQuestion = String(interaction.options.getString("question", true) ?? "").trim().slice(0, 1000);
  if (!guildId || !userId || !rawQuestion) {
    await interaction.reply({ content: "Cette aide doit être utilisée depuis un serveur avec une question.", ephemeral: true, allowedMentions: noMentions });
    return true;
  }
  if (containsSecretInput(rawQuestion)) {
    await interaction.reply({ content: "Pour ta sécurité, ne partage jamais de token, mot de passe ou clé API. Reformule ta question sans cette information.", ephemeral: true, allowedMentions: noMentions });
    return true;
  }
  const question = redactPrivateText(rawQuestion);
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
        knowledge: knowledge.slice(0, 6).map((page) => ({ ...page, content: redactPrivateText(page.content) })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error(describePndAiFailure(response.status, data, "chat"));
    }
    if (hasUnknownCommandReference(data.reply, commands)) {
      await interaction.editReply({
        content: "Je ne peux pas confirmer la commande ou la sous-commande proposée. Consulte `/aide` pour le catalogue officiel ou utilise le panneau de support.",
        allowedMentions: noMentions,
      });
      return true;
    }
    await interaction.editReply({ content: data.reply.slice(0, 1900), allowedMentions: noMentions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "L'assistant est indisponible.";
    await interaction.editReply({ content: `⚠️ ${message} Utilise \`/aide\` ou le support si besoin.`, allowedMentions: noMentions }).catch(() => {});
  }
  return true;
}
