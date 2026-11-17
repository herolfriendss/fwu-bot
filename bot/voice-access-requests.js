import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "./database.js";
import {
  canRequestFromVoiceChat,
  isDiscordSnowflake,
  MAX_PENDING_VOICE_ACCESS_REQUESTS,
  isVoiceAccessRequestExpired,
  matchesVoiceAccessRequestMessage,
  parseVoiceChannelId,
  VOICE_ACCESS_REQUEST_TTL,
  voiceAccessGrantPermissions,
} from "./voice-access-request-policy.js";

const pendingDecision = new Set();

async function isReviewer(interaction, settings) {
  if (!interaction.guild) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const sysPlusRoleId = settings?.sysPlus?.roleId;
  return typeof sysPlusRoleId === "string" && member.roles.cache.has(sysPlusRoleId);
}

function decisionRow(requestId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`voice-access:approve:${requestId}`)
      .setLabel("Autoriser")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`voice-access:deny:${requestId}`)
      .setLabel("Refuser")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function requestCard({ id, requesterId, voiceChannel, reason, createdAt }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🔐 Demande d’accès vocal")
    .setDescription(`<@${requesterId}> souhaite rejoindre **${voiceChannel.name}**.`)
    .addFields(
      { name: "Salon demandé", value: `<#${voiceChannel.id}>`, inline: true },
      { name: "Demandeur", value: `<@${requesterId}>`, inline: true },
      { name: "Motif", value: reason || "Aucun motif renseigné" },
      { name: "Référence", value: `#${id}`, inline: true },
    )
    .setTimestamp(createdAt);
  return { embeds: [embed], components: [decisionRow(id)], allowedMentions: { users: [requesterId] } };
}

async function publishPanel(interaction) {
  if (!interaction.inGuild() || !interaction.channel?.isSendable?.()) {
    await interaction.reply({ content: "Publie le panneau dans un salon textuel ou dans le chat d’un salon vocal.", ephemeral: true });
    return true;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "Il faut la permission « Gérer les salons » pour publier ce panneau.", ephemeral: true });
    return true;
  }

  const isVoice = interaction.channel.type === ChannelType.GuildVoice;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🔐 Accès aux salons vocaux")
    .setDescription(isVoice
      ? "Tu souhaites rejoindre ce salon ? Utilise le bouton ci-dessous pour envoyer une demande au staff."
      : "Tu souhaites rejoindre un salon vocal privé ? Clique ci-dessous et indique l’identifiant du salon demandé.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`voice-access:open:${interaction.channelId}`)
      .setLabel("Demander l’accès")
      .setEmoji("🔑")
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.deferReply({ ephemeral: true });
  try {
    await interaction.channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    await interaction.editReply("✅ Panneau de demande d’accès publié.");
  } catch {
    await interaction.editReply("❌ Impossible de publier le panneau. Vérifie mes permissions dans ce salon.");
  }
  return true;
}

function buildRequestModal(sourceChannelId, voiceChannelId = null) {
  const modal = new ModalBuilder()
    .setCustomId(`voice-access:submit:${sourceChannelId}:${voiceChannelId ?? "select"}`)
    .setTitle("Demander un accès vocal");

  const rows = [];
  if (!voiceChannelId) {
    const channelInput = new TextInputBuilder()
      .setCustomId("voice_channel_id")
      .setLabel("Nom, identifiant ou lien du salon")
      .setPlaceholder("Ex. vocal-staff, ID ou lien du salon")
      .setStyle(TextInputStyle.Short)
      .setMinLength(5)
      .setMaxLength(100)
      .setRequired(true);
    rows.push(new ActionRowBuilder().addComponents(channelInput));
  }
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Motif de la demande (facultatif)")
    .setPlaceholder("Explique brièvement pourquoi tu souhaites le rejoindre")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(false);
  rows.push(new ActionRowBuilder().addComponents(reasonInput));
  modal.addComponents(...rows);
  return modal;
}


async function submitRequest(interaction, sourceChannelId, presetVoiceChannelId) {
  await interaction.deferReply({ ephemeral: true });
  const channelInput = presetVoiceChannelId === "select"
    ? interaction.fields.getTextInputValue("voice_channel_id").trim()
    : presetVoiceChannelId;
  const voiceChannelId = parseVoiceChannelId(channelInput);
  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);
  let voiceChannel = voiceChannelId
    ? await guild.channels.fetch(voiceChannelId).catch(() => null)
    : null;
  if (!voiceChannel && !voiceChannelId) {
    const normalizedName = channelInput.replace(/^#/, "").trim().toLocaleLowerCase();
    const channels = await guild.channels.fetch();
    const matches = channels.filter((channel) =>
      channel.type === ChannelType.GuildVoice && channel.name.toLocaleLowerCase() === normalizedName,
    );
    if (matches.size > 1) throw new Error("Plusieurs salons portent ce nom. Utilise l’identifiant du salon.");
    voiceChannel = matches.first() ?? null;
  }
  if (!voiceChannel || voiceChannel.guildId !== guild.id || voiceChannel.type !== ChannelType.GuildVoice) {
    throw new Error("Je ne trouve pas ce salon vocal. Vérifie son nom, son identifiant ou son lien.");
  }

  const requesterPermissions = voiceChannel.permissionsFor(member);
  if (requesterPermissions?.has(PermissionFlagsBits.Connect)) {
    throw new Error("Tu as déjà l’autorisation de rejoindre ce salon vocal.");
  }

  const botMember = await guild.members.fetchMe();
  const botPermissions = voiceChannel.permissionsFor(botMember);
  if (!botPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
    throw new Error("Le bot doit pouvoir voir le salon vocal et gérer ses permissions pour traiter les demandes.");
  }

  const canUseVoiceChat = canRequestFromVoiceChat(requesterPermissions?.bitfield ?? 0n);
  let destination = null;
  if (canUseVoiceChat && botPermissions.has(PermissionFlagsBits.SendMessages)) {
    destination = voiceChannel;
  } else {
    const source = await guild.channels.fetch(sourceChannelId).catch(() => null);
    if (!source || source.type === ChannelType.GuildVoice) {
      throw new Error("Ce salon est invisible ou son chat n’est pas accessible. Utilise le panneau général publié dans un salon textuel.");
    }
    const sourcePermissions = source.permissionsFor(botMember);
    if (!source.isSendable?.() || !sourcePermissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error("Le panneau général n’est plus accessible. Demande au staff d’en publier un nouveau.");
    }
    destination = source;
  }

  const now = Date.now();
  db.prepare("UPDATE voice_access_requests SET status='expired', decided_at=? WHERE guild_id=? AND status='pending' AND created_at<?")
    .run(now, guild.id, now - VOICE_ACCESS_REQUEST_TTL);

  const pendingCount = db.prepare(
    "SELECT COUNT(*) AS count FROM voice_access_requests WHERE guild_id=? AND requester_id=? AND status='pending'",
  ).get(guild.id, interaction.user.id);
  if (Number(pendingCount?.count ?? 0) >= MAX_PENDING_VOICE_ACCESS_REQUESTS) {
    throw new Error(`Tu as déjà ${MAX_PENDING_VOICE_ACCESS_REQUESTS} demandes en attente. Attends une réponse du staff avant d’en envoyer d’autres.`);
  }

  const existing = db.prepare("SELECT id FROM voice_access_requests WHERE guild_id=? AND voice_channel_id=? AND requester_id=? AND status='pending'")
    .get(guild.id, voiceChannel.id, interaction.user.id);
  if (existing) throw new Error("Tu as déjà une demande en attente pour ce salon.");

  const insert = db.prepare(
    "INSERT INTO voice_access_requests (guild_id, voice_channel_id, requester_id, request_channel_id, status, reason, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
  );
  let requestId;
  try {
    requestId = Number(insert.run(guild.id, voiceChannel.id, interaction.user.id, destination.id,
      interaction.fields.getTextInputValue("reason").trim(), now).lastInsertRowid);
  } catch (error) {
    if (String(error?.message ?? "").includes("UNIQUE")) {
      throw new Error("Tu as déjà une demande en attente pour ce salon.");
    }
    throw error;
  }

  try {
    const message = await destination.send(requestCard({
      id: requestId,
      requesterId: interaction.user.id,
      voiceChannel,
      reason: interaction.fields.getTextInputValue("reason").trim(),
      createdAt: now,
    }));
    const savedMessage = db.prepare("UPDATE voice_access_requests SET message_id=? WHERE id=? AND status='pending'").run(message.id, requestId);
    if (savedMessage.changes !== 1) throw new Error("Impossible d’enregistrer la référence du message de demande.");
  } catch (error) {
    db.prepare("DELETE FROM voice_access_requests WHERE id=? AND status='pending'").run(requestId);
    throw new Error("Impossible de publier la demande. Vérifie les permissions du bot dans le salon de demande.");
  }

  await interaction.editReply({
    content: `✅ Ta demande d’accès à **${voiceChannel.name}** a été envoyée au staff.`,
    allowedMentions: { parse: [] },
  });
}

async function decideRequest(interaction, settings, action, requestId) {
  if (!await isReviewer(interaction, settings)) {
    await interaction.followUp({ content: "Cette décision est réservée au staff autorisé.", ephemeral: true });
    return;
  }
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Référence de demande invalide.");
  const request = db.prepare("SELECT * FROM voice_access_requests WHERE id=? AND guild_id=?").get(id, interaction.guildId);
  if (!request || request.status !== "pending") throw new Error("Cette demande n’est plus en attente.");
  if (!matchesVoiceAccessRequestMessage(request.message_id, interaction.message?.id)) {
    throw new Error("Ce bouton ne correspond pas au message de demande enregistré.");
  }
  if (isVoiceAccessRequestExpired(request.created_at)) {
    db.prepare("UPDATE voice_access_requests SET status='expired', decided_at=? WHERE id=? AND status='pending'").run(Date.now(), id);
    await interaction.message.edit({
      embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle("⌛ Demande expirée").setDescription(`Demande #${id} · <@${request.requester_id}> · <#${request.voice_channel_id}>`)],
      components: [decisionRow(id, true)],
      allowedMentions: { parse: [] },
    });
    await interaction.followUp({ content: "Cette demande a expiré. Le membre doit en envoyer une nouvelle.", ephemeral: true });
    return;
  }
  if (pendingDecision.has(id)) throw new Error("Une décision est déjà en cours pour cette demande.");
  pendingDecision.add(id);
  try {
    if (action === "approve") {
      const channel = await interaction.guild.channels.fetch(request.voice_channel_id).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Le salon vocal n’existe plus.");
      const botMember = await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error("Le bot n’a pas la permission « Gérer les salons » dans ce vocal.");
      }
      await channel.permissionOverwrites.edit(request.requester_id, voiceAccessGrantPermissions(), {
        reason: `Demande d’accès vocal #${id} approuvée par ${interaction.user.tag}`,
      });
    }
    const status = action === "approve" ? "approved" : "denied";
    const result = db.prepare(
      "UPDATE voice_access_requests SET status=?, decided_at=?, decided_by=? WHERE id=? AND status='pending'",
    ).run(status, Date.now(), interaction.user.id, id);
    if (result.changes !== 1) throw new Error("Cette demande a déjà été traitée.");
    await interaction.message.edit({
      embeds: [new EmbedBuilder()
        .setColor(action === "approve" ? 0x57f287 : 0xed4245)
        .setTitle(action === "approve" ? "✅ Demande approuvée" : "⛔ Demande refusée")
        .setDescription(`Demande #${id} · <@${request.requester_id}> · <#${request.voice_channel_id}>`)
        .addFields({ name: "Décision", value: `Par <@${interaction.user.id}>` })
        .setTimestamp()],
      components: [decisionRow(id, true)],
      allowedMentions: { parse: [] },
    });
  } finally {
    pendingDecision.delete(id);
  }
}

export async function handleVoiceAccessRequestInteraction(interaction, settings = {}) {
  if (interaction.isChatInputCommand() && interaction.commandName === "voice-request-panel") {
    return publishPanel(interaction);
  }

  if (interaction.isButton() && interaction.customId.startsWith("voice-access:open:")) {
    const sourceChannelId = interaction.customId.split(":")[2];
    if (!interaction.guild || !isDiscordSnowflake(sourceChannelId)) {
      await interaction.reply({ content: "Ce panneau est invalide.", ephemeral: true });
      return true;
    }
    const source = await interaction.guild.channels.fetch(sourceChannelId).catch(() => null);
    if (!source) {
      await interaction.reply({ content: "Ce salon n’existe plus. Demande au staff de republier le panneau.", ephemeral: true });
      return true;
    }
    const preset = source.type === ChannelType.GuildVoice ? source.id : null;
    await interaction.showModal(buildRequestModal(sourceChannelId, preset));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("voice-access:submit:")) {
    const [, , sourceChannelId, voiceChannelId] = interaction.customId.split(":");
    if (!interaction.guild || !isDiscordSnowflake(sourceChannelId) || (voiceChannelId !== "select" && !isDiscordSnowflake(voiceChannelId))) {
      await interaction.reply({ content: "Cette demande est invalide.", ephemeral: true });
      return true;
    }
    try {
      await submitRequest(interaction, sourceChannelId, voiceChannelId);
    } catch (error) {
      const content = error instanceof Error ? error.message : "Impossible d’envoyer la demande.";
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
    return true;
  }

  if (interaction.isButton() && /^voice-access:(approve|deny):\d+$/.test(interaction.customId)) {
    const [, action, requestId] = interaction.customId.split(":");
    try {
      // Acknowledge the component interaction immediately. Channel permission
      // updates and message edits can take longer than Discord's 3-second
      // acknowledgement window; without deferUpdate, followUp may fail.
      await interaction.deferUpdate();
      await decideRequest(interaction, settings, action, requestId);
    } catch (error) {
      const response = error instanceof Error ? error.message : "Impossible de traiter la demande.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: response, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: response, ephemeral: true }).catch(() => {});
      }
    }
    return true;
  }
  return false;
}
