// /confession — the member-facing side of anonymous confessions, plus the
// staff review buttons. The public message never names the author; the review
// copy always does.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits as P } from "discord.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import {
  canConfess, confessionConfig, saveConfessionConfig, validateAttachment, recordConfession,
  confessionById, markConfession, publishConfession, confessionEmbed, confessionStats,
  blockConfessor, unblockConfessor, isBlocked, MAX_BODY,
} from "./confessions.js";

export const CONFESSION_COMMANDS = new Set(["confession"]);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

const isStaff = (member) =>
  member?.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID)
  || member?.id === member?.guild?.ownerId
  || Boolean(member?.permissions?.has?.(P.Administrator) || member?.permissions?.has?.(P.ManageMessages));

/** The staff copy: same content, plus who wrote it and what to do about it. */
function reviewPayload(row, { decided = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(decided === "published" ? 0x16a34a : decided === "rejected" ? 0x7f1d1d : 0xe21d2f)
    .setTitle(`🤫 Confession #${row.number} — ${decided === "published" ? "publiée" : decided === "rejected" ? "refusée" : "en attente"}`)
    .setDescription(row.body || "*(aucun texte)*")
    .addFields({ name: "Auteur", value: `<@${row.author_id}> \`${row.author_id}\`` })
    .setTimestamp(Number(row.created_at));
  if (row.image_url) embed.addFields({ name: "Image", value: `[Voir le fichier](${row.image_url})` });
  if (row.audio_url) embed.addFields({ name: "Vocal", value: `[Écouter le fichier](${row.audio_url})` });
  if (row.image_url) embed.setThumbnail(row.image_url);
  const components = decided ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confess:ok:${row.id}`).setLabel("Publier").setStyle(ButtonStyle.Success).setEmoji("✅"),
    new ButtonBuilder().setCustomId(`confess:no:${row.id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger).setEmoji("🚫"),
    new ButtonBuilder().setCustomId(`confess:block:${row.id}`).setLabel("Refuser et bloquer").setStyle(ButtonStyle.Secondary).setEmoji("⛔"),
  )];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function sendToReview(guild, row, options) {
  const { reviewChannelId } = confessionConfig(guild.id);
  if (!reviewChannelId) return null;
  const channel = await guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel.send(reviewPayload(row, options)).catch(() => null);
}

async function submit(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const verdict = canConfess(guildId, userId, { member: interaction.member });
  if (!verdict.ok) return interaction.reply(ephemeral(`❌ ${verdict.reason}`));

  const body = interaction.options.getString("texte") ?? "";
  const image = validateAttachment(interaction.options.getAttachment("image"), "image");
  if (!image.ok) return interaction.reply(ephemeral(`❌ ${image.reason}`));
  const audio = validateAttachment(interaction.options.getAttachment("vocal"), "audio");
  if (!audio.ok) return interaction.reply(ephemeral(`❌ ${audio.reason}`));
  if (!body.trim() && !image.url && !audio.url) {
    return interaction.reply(ephemeral("❌ Écris un texte, joins une image ou un vocal."));
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const moderated = verdict.config.moderated;
  const saved = recordConfession({
    guildId, authorId: userId, body, imageUrl: image.url, audioUrl: audio.url,
    status: moderated ? "pending" : "published",
  });
  const row = confessionById(saved.id);

  if (moderated) {
    const sent = await sendToReview(interaction.guild, row);
    if (!sent) {
      markConfession(saved.id, "rejected", null);
      return interaction.editReply("❌ Aucun salon de modération n'est configuré : la confession n'a pas pu être transmise. Préviens le staff.");
    }
    return interaction.editReply(`✅ Confession **#${saved.number}** envoyée au staff. Elle sera publiée anonymement après relecture.`);
  }

  try {
    await publishConfession(interaction.guild, row);
  } catch (error) {
    markConfession(saved.id, "rejected", null);
    return interaction.editReply(`❌ ${error instanceof Error ? error.message : "Publication impossible."}`);
  }
  // Traceability: even unmoderated confessions are archived with their author.
  await sendToReview(interaction.guild, confessionById(saved.id), { decided: "published" });
  return interaction.editReply(`✅ Confession **#${saved.number}** publiée anonymement.`);
}

async function review(interaction, action, id) {
  if (!isStaff(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff."));
  const row = confessionById(Number(id));
  if (!row) return interaction.reply(ephemeral("Confession introuvable."));
  if (row.status !== "pending") return interaction.reply(ephemeral("Cette confession a déjà été traitée."));

  await interaction.deferUpdate();
  if (action === "ok") {
    try {
      await publishConfession(interaction.guild, { ...row, reviewer_id: interaction.user.id });
    } catch (error) {
      await interaction.followUp(ephemeral(`❌ ${error instanceof Error ? error.message : "Publication impossible."}`));
      return true;
    }
    markConfession(row.id, "published", interaction.user.id);
  } else {
    markConfession(row.id, "rejected", interaction.user.id);
    if (action === "block") blockConfessor(row.guild_id, row.author_id, interaction.user.id, `Confession #${row.number}`);
  }
  const decided = action === "ok" ? "published" : "rejected";
  await interaction.editReply(reviewPayload(confessionById(row.id), { decided }));
  if (action === "block") {
    await interaction.followUp(ephemeral(`⛔ <@${row.author_id}> ne peut plus envoyer de confessions.`));
  }
  return true;
}

async function configure(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff."));
  const channel = interaction.options.getChannel("salon");
  const reviewChannel = interaction.options.getChannel("salon_moderation");
  const moderated = interaction.options.getBoolean("moderation");
  const minTrust = interaction.options.getInteger("confiance_minimale");
  const dailyLimit = interaction.options.getInteger("par_jour");

  const next = saveConfessionConfig(interaction.guildId, {
    ...(channel ? { channelId: channel.id } : {}),
    ...(reviewChannel ? { reviewChannelId: reviewChannel.id } : {}),
    ...(moderated === null ? {} : { moderated }),
    ...(minTrust === null ? {} : { minTrust }),
    ...(dailyLimit === null ? {} : { dailyLimit }),
  });
  return interaction.reply(ephemeral([
    "✅ **Confessions configurées**",
    `Salon public : ${next.channelId ? `<#${next.channelId}>` : "*non défini*"}`,
    `Salon de modération : ${next.reviewChannelId ? `<#${next.reviewChannelId}>` : "*non défini*"}`,
    `Relecture avant publication : **${next.moderated ? "oui" : "non"}**`,
    `Score de confiance minimal : **${next.minTrust}**`,
    `Limite : **${next.dailyLimit} par jour**`,
    next.reviewChannelId ? "" : "\n⚠️ Sans salon de modération, les confessions ne peuvent pas être relues ni tracées.",
  ].filter(Boolean).join("\n")));
}

export async function handleConfessionInteraction(interaction) {
  try {
    if (interaction.isButton?.() && interaction.customId?.startsWith("confess:")) {
      const [, action, id] = interaction.customId.split(":");
      return await review(interaction, action, id);
    }
    if (!interaction.isChatInputCommand?.() || !CONFESSION_COMMANDS.has(interaction.commandName)) return false;
    if (!interaction.guildId) return false;

    switch (interaction.options.getSubcommand()) {
      case "envoyer": await submit(interaction); return true;
      case "config": await configure(interaction); return true;
      case "bloquer": {
        if (!isStaff(interaction.member)) { await interaction.reply(ephemeral("⛔ Réservé au staff.")); return true; }
        const target = interaction.options.getUser("membre");
        blockConfessor(interaction.guildId, target.id, interaction.user.id, interaction.options.getString("raison") ?? null);
        await interaction.reply(ephemeral(`⛔ <@${target.id}> ne peut plus envoyer de confessions.`));
        return true;
      }
      case "debloquer": {
        if (!isStaff(interaction.member)) { await interaction.reply(ephemeral("⛔ Réservé au staff.")); return true; }
        const target = interaction.options.getUser("membre");
        const lifted = unblockConfessor(interaction.guildId, target.id);
        await interaction.reply(ephemeral(lifted ? `✅ <@${target.id}> peut de nouveau confesser.` : "Ce membre n'était pas bloqué."));
        return true;
      }
      case "stats": {
        const stats = confessionStats(interaction.guildId);
        const config = confessionConfig(interaction.guildId);
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xe21d2f).setTitle("🤫 Confessions du serveur").addFields(
            { name: "Publiées", value: String(stats.published), inline: true },
            { name: "En attente", value: String(stats.pending), inline: true },
            { name: "Refusées", value: String(stats.rejected), inline: true },
            { name: "Salon", value: config.channelId ? `<#${config.channelId}>` : "*non défini*", inline: true },
            { name: "Relecture", value: config.moderated ? "activée" : "désactivée", inline: true },
            { name: "Ton accès", value: isBlocked(interaction.guildId, interaction.user.id) ? "bloqué" : "ouvert", inline: true },
          )],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      default: return false;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
    return true;
  }
}

export { MAX_BODY };
