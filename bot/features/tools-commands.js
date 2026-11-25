// /outils (SUCK ME) : message collé en bas d'un salon et modmail.
// Une seule commande racine (SUCK ME approche la limite de 100 commandes).
import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits as P } from "discord.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { onStickyChannelMessage, removeSticky, repostSticky, setSticky, stickyList } from "./sticky.js";
import {
  blockModmail, closeFromThread, handleModmailDm, isPrivateChannel, modmailConfig, openFromButton, replyToMember,
  saveModmailConfig, unblockModmail,
} from "./modmail.js";

export const TOOLS_COMMANDS = new Set(["outils"]);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const TEXT = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const isOwnerLike = (member) =>
  member?.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member?.id === member?.guild?.ownerId || Boolean(member?.permissions?.has?.(P.Administrator));
export const canManageServer = (member) => Boolean(member) && (isOwnerLike(member) || Boolean(member.permissions?.has?.(P.ManageGuild)));
export const canManageMessages = (member) => canManageServer(member) || Boolean(member?.permissions?.has?.(P.ManageMessages));

function missingBotPerms(channel, needed) {
  const me = channel?.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms) return "je ne vois pas ce salon";
  const missing = needed.filter(([flag]) => !perms.has(flag)).map(([, label]) => label);
  return missing.length ? `il me manque : ${missing.join(", ")}` : null;
}

async function sticky(interaction, sub) {
  if (!canManageMessages(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff (Gérer les messages)."));
  if (sub === "liste") {
    const rows = stickyList(interaction.guildId);
    return interaction.reply(ephemeral(rows.length
      ? `📌 **Messages collés**\n${rows.map((r) => `<#${r.channelId}> · ${r.content.slice(0, 80).replace(/\n/g, " ")}${r.content.length > 80 ? "…" : ""}`).join("\n")}`
      : "📌 Aucun message collé sur ce serveur."));
  }
  const channel = interaction.options.getChannel("salon", true);
  if (sub === "retirer") {
    const removed = removeSticky(interaction.guildId, channel.id);
    if (!removed) return interaction.reply(ephemeral("Aucun message collé dans ce salon."));
    if (removed.previousMessageId) await channel.messages?.delete?.(removed.previousMessageId).catch(() => {});
    return interaction.reply(ephemeral(`✅ Message collé retiré de <#${channel.id}>.`));
  }
  if (sub === "definir") {
    if (!TEXT.has(channel.type)) return interaction.reply(ephemeral("❌ Choisis un salon textuel."));
    const problem = missingBotPerms(channel, [[P.ViewChannel, "Voir le salon"], [P.SendMessages, "Envoyer des messages"], [P.EmbedLinks, "Intégrer des liens"], [P.ManageMessages, "Gérer les messages"]]);
    if (problem) return interaction.reply(ephemeral(`❌ Dans <#${channel.id}>, ${problem}.`));
    const saved = setSticky({ guildId: interaction.guildId, channelId: channel.id, content: interaction.options.getString("texte", true), authorId: interaction.user.id });
    if (saved.previousMessageId) await channel.messages?.delete?.(saved.previousMessageId).catch(() => {});
    await repostSticky(channel).catch(() => {});
    return interaction.reply(ephemeral(`✅ Message collé en bas de <#${channel.id}>. Il sera republié après chaque échange (avec quelques secondes de calme).\nAstuce : \`\\n\` pour aller à la ligne.`));
  }
  return false;
}

async function modmail(interaction, sub, client) {
  if (sub === "repondre") {
    await interaction.deferReply();
    const sent = await replyToMember(interaction, client, interaction.options.getString("message", true), interaction.options.getBoolean("anonyme"));
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x22c55e).setAuthor({ name: `📤 Envoyé par ${interaction.member?.displayName ?? interaction.user.username}${sent.anonymous ? " (anonyme pour le membre)" : ""}` }).setDescription(sent.text)],
      allowedMentions: { parse: [] },
    });
  }
  if (sub === "fermer") {
    const reason = interaction.options.getString("raison");
    await closeFromThread(interaction, client, reason);
    await interaction.reply({ content: `📪 Conversation fermée par <@${interaction.user.id}>${reason ? ` : ${reason}` : ""}.`, allowedMentions: { parse: [] } });
    await interaction.channel?.setLocked?.(true).catch(() => {});
    await interaction.channel?.setArchived?.(true).catch(() => {});
    return true;
  }
  if (!canManageServer(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff (Gérer le serveur)."));
  if (sub === "config") {
    const channel = interaction.options.getChannel("salon", true);
    if (channel.type !== ChannelType.GuildText) return interaction.reply(ephemeral("❌ Choisis un salon textuel."));
    if (!isPrivateChannel(channel)) return interaction.reply(ephemeral("❌ Ce salon est visible par @everyone. Le modmail doit aller dans un salon réservé au staff."));
    const problem = missingBotPerms(channel, [[P.ViewChannel, "Voir le salon"], [P.SendMessages, "Envoyer des messages"], [P.EmbedLinks, "Intégrer des liens"], [P.CreatePublicThreads, "Créer des fils publics"], [P.SendMessagesInThreads, "Envoyer dans les fils"], [P.ManageThreads, "Gérer les fils"]]);
    if (problem) return interaction.reply(ephemeral(`❌ Dans <#${channel.id}>, ${problem}.`));
    const anonymous = interaction.options.getBoolean("anonyme");
    const next = saveModmailConfig(interaction.guildId, { channelId: channel.id, enabled: true, ...(anonymous === null ? {} : { anonymous }) });
    return interaction.reply(ephemeral(`✅ Modmail activé : chaque conversation ouvre un fil dans <#${channel.id}>.\nLes réponses du staff sont signées **${next.anonymous ? "« Staff du serveur »" : "du nom du membre du staff"}**.\nLes membres écrivent simplement en MP à ce bot.`));
  }
  if (sub === "desactiver") {
    saveModmailConfig(interaction.guildId, { enabled: false });
    return interaction.reply(ephemeral("✅ Modmail désactivé. Les conversations ouvertes restent consultables."));
  }
  if (sub === "bloquer") {
    const user = interaction.options.getUser("membre", true);
    blockModmail(interaction.guildId, user.id, interaction.user.id);
    return interaction.reply(ephemeral(`⛔ <@${user.id}> ne peut plus ouvrir de conversation modmail.`));
  }
  if (sub === "debloquer") {
    const user = interaction.options.getUser("membre", true);
    return interaction.reply(ephemeral(unblockModmail(interaction.guildId, user.id) ? `✅ <@${user.id}> peut de nouveau écrire au staff.` : "Ce membre n'était pas bloqué."));
  }
  if (sub === "etat") {
    const config = modmailConfig(interaction.guildId);
    return interaction.reply(ephemeral(`📨 Modmail : **${config.enabled && config.channelId ? `activé dans <#${config.channelId}>` : "désactivé"}** · réponses ${config.anonymous ? "anonymes" : "signées"}.`));
  }
  return false;
}

/**
 * @param {object} ctx { client, guildAllowed(guildId) }
 */
export async function handleToolsInteraction(interaction, ctx) {
  const isCommand = interaction.isChatInputCommand?.() && TOOLS_COMMANDS.has(interaction.commandName);
  const isButton = interaction.isButton?.() && /^mm:(open:\d{5,25}|cancel)$/.test(interaction.customId ?? "");
  if (!isCommand && !isButton) return false;
  try {
    if (isButton) {
      if (interaction.customId === "mm:cancel") {
        await interaction.update({ content: "Message non envoyé.", components: [] });
        return true;
      }
      await openFromButton(interaction, ctx);
      return true;
    }
    if (!interaction.guildId) { await interaction.reply(ephemeral("Cette commande s'utilise sur un serveur.")); return true; }
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const handled = group === "sticky" ? await sticky(interaction, sub) : group === "modmail" ? await modmail(interaction, sub, ctx.client) : false;
    if (handled === false && !interaction.replied && !interaction.deferred) await interaction.reply(ephemeral("Sous-commande inconnue."));
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred) await interaction.editReply({ content, embeds: [] }).catch(() => {});
    else if (interaction.replied) await interaction.followUp(ephemeral(content)).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
  }
  return true;
}

export { handleModmailDm, onStickyChannelMessage };
