// Her? V4 — tickets staff : panneau, ouverture, prise en charge et clôture.
//
// Chaque ticket possède son propre salon et sa ligne SQLite, indexée par
// serveur. Les permissions sont revérifiées à chaque bouton et commande.
import { askTicketRating, formatRatingStats, ratingStats } from "./features/ticket-rating.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { AttachmentBuilder } from "discord.js";
import { db } from "./database.js";
import { fetchChannelMessages, formatTicketTimeline, getTranscript, listTicketEvents, recordTicketEvent, renderTranscript, saveTranscript, transcriptRetentionDays } from "./ticket-records.js";
import { incrementDailyMetric } from "./organization.js";
import { sendCentralLog } from "./logs.js";
import { herBotAvatar, themePanelEmbed } from "./theme.js";
import { respondToInteraction } from "./interaction-response.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { canUseAdminPlusScope, getAdminPlusScope } from "./systems/sysplus/admin-plus-scopes.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { listResponseTemplates, renderResponseTemplate } from "./response-templates.js";
import {
  canActOnTicket, sanitizeTicketSubject, ticketChannelName, ticketDuration, ticketOpenAllowed, ticketStatusLabel, ticketSetupIssue, parseTicketPrefixCommand,
} from "./tickets-policy.js";

const P = PermissionFlagsBits;
// Prevent two near-simultaneous button clicks from creating duplicate ticket channels
// for the same member while the Discord API calls are still in flight.
const openingTickets = new Set();

function mention(id) { return `<@${id}>`; }

function isTicketStaff(member, settings) {
  if (!member?.guild) return false;
  if (member.id === member.guild.ownerId || member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID)) return true;
  if (member.permissions.has(P.Administrator) || member.permissions.has(P.ManageChannels)) return true;
  if (settings?.tickets?.supportRoleId && member.roles.cache.has(settings.tickets.supportRoleId)) return true;
  const adminRoleId = settings?.adminPlus?.roleId ?? getAdminPlusRoleId(member.guild.id);
  return canUseAdminPlusScope(member, settings?.sysPlus?.roleId ?? null, adminRoleId, "tickets", getAdminPlusScope(member.guild.id, "tickets"));
}

function ticketRow(channelId, guildId) {
  return db.prepare("SELECT * FROM tickets WHERE channel_id=? AND guild_id=?").get(channelId, guildId) ?? null;
}

function openTicketsFor(guildId, userId) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE guild_id=? AND user_id=? AND status='open'").get(guildId, userId).count);
}

async function sendTicketLog(guild, settings, embed) {
  await sendCentralLog(guild, settings, embed, [settings?.tickets?.logChannelId], [], [], { category: "tickets" }).catch(() => {});
}

function ticketLogEmbed(guild, interaction, action, ticket, extra = []) {
  return new EmbedBuilder()
    .setColor(action === "closed" ? 0x6b7280 : 0xe21d2f)
    .setTitle(`🎫 Ticket — ${action}`)
    .addFields(
      { name: "Ticket", value: `#${ticket.id}`, inline: true },
      { name: "Auteur", value: mention(ticket.user_id), inline: true },
      { name: "Agent", value: mention(interaction.user.id), inline: true },
      ...extra,
      { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
    )
    .setTimestamp(new Date());
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:open").setLabel("Ouvrir un ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary),
  );
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:claim").setLabel("Prendre en charge").setEmoji("🙋").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:templates").setLabel("Réponse rapide").setEmoji("📝").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );
}

async function ticketTemplateContext(interaction, guildSettings) {
  const guild = interaction.guild;
  if (!guild) throw new Error("Cette action doit être utilisée dans un ticket de serveur.");
  const member = interaction.member ?? guild.members.cache.get(interaction.user.id) ?? null;
  if (!member || !isTicketStaff(member, guildSettings)) throw new Error("Réservé au staff support.");
  const row = ticketRow(interaction.channelId, guild.id);
  if (!row || row.status !== "open") throw new Error("Ce ticket est déjà fermé.");
  return { guild, member, row };
}

async function ticketTemplateButton(interaction, guildSettings) {
  try {
    await ticketTemplateContext(interaction, guildSettings ?? {});
    const options = listResponseTemplates("ticket").map((template) => ({
      label: template.label,
      description: template.description,
      value: template.id,
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket:template:select")
      .setPlaceholder("Choisir une réponse à préparer")
      .addOptions(options);
    await interaction.reply({
      content: "Choisis un modèle. Tu pourras modifier le texte avant de l'envoyer.",
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const payload = { content: error?.message ?? "Impossible d'ouvrir les modèles.", ephemeral: true, allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
  return true;
}

async function ticketTemplateSelect(interaction, guildSettings) {
  try {
    const { guild, member, row } = await ticketTemplateContext(interaction, guildSettings ?? {});
    const templateId = interaction.values?.[0];
    // Modal responses must be acknowledged within Discord’s 3-second window; use cache only here.
    const target = guild.members.cache.get(row.user_id) ?? null;
    const body = renderResponseTemplate("ticket", templateId, {
      member: target?.displayName ?? "bonjour",
      staff: member.displayName ?? interaction.user.username,
      ticket_id: row.id,
      subject: row.subject,
      server: guild.name,
    });
    if (!body) throw new Error("Ce modèle n'existe plus.");
    const modal = new ModalBuilder()
      .setCustomId("ticket:template:modal")
      .setTitle("Modifier la réponse");
    const input = new TextInputBuilder()
      .setCustomId("body")
      .setLabel("Message à envoyer")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1900)
      .setValue(body);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  } catch (error) {
    const payload = { content: error?.message ?? "Impossible de préparer cette réponse.", ephemeral: true, allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
  return true;
}

async function ticketTemplateModal(interaction, guildSettings, record = () => {}) {
  try {
    const { guild, row } = await ticketTemplateContext(interaction, guildSettings ?? {});
    const body = String(interaction.fields.getTextInputValue("body") ?? "").trim().slice(0, 1900);
    if (!body) throw new Error("Le message ne peut pas être vide.");
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel ?? await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") throw new Error("Salon du ticket introuvable.");
    await channel.send({ content: body, allowedMentions: { parse: [] } });
    recordTicketEvent({ guildId: guild.id, ticketId: row.id, action: "template_sent", actorId: interaction.user.id });
    await interaction.editReply({ content: "Réponse envoyée dans le ticket.", allowedMentions: { parse: [] } });
    record("ticket_template_sent");
  } catch (error) {
    const message = error?.message ?? "Impossible d'envoyer cette réponse.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, allowedMentions: { parse: [] } }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    }
  }
  return true;
}

function panelEmbed(settings, guild) {
  return themePanelEmbed(new EmbedBuilder()
    .setTitle("🌙 Support")
    .setDescription(settings?.tickets?.supportRoleId
      ? "Besoin d’aide ? Clique sur le bouton ci-dessous. Un membre du staff te répondra."
      : "Besoin d’aide ? Clique sur le bouton ci-dessous pour ouvrir un ticket privé.")
    .setFooter({ text: "Un seul ticket ouvert à la fois par défaut." }), { thumbnailUrl: herBotAvatar(guild) });
}

function ticketWelcomeEmbed(ticket, member, settings) {
  return themePanelEmbed(new EmbedBuilder()
    .setTitle(`🌙 Ticket #${ticket.id}`)
    .setDescription("Décris ta demande ici. Un membre du staff va te répondre.\nUtilise **Fermer** quand tout est réglé.")
    .addFields(
      { name: "Auteur", value: mention(member.id), inline: true },
      { name: "Sujet", value: ticket.subject, inline: true },
      { name: "Support", value: settings?.tickets?.supportRoleId ? `<@&${settings.tickets.supportRoleId}>` : "Staff du serveur", inline: true },
    ), { thumbnailUrl: herBotAvatar(member.guild) });
}

async function closeTicket({ guild, settings, interaction, row, reason, record }) {
  const closed = db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=? AND guild_id=? AND status='open'")
    .run(Date.now(), row.id, guild.id);
  if (!Number(closed.changes)) throw new Error("Ce ticket vient déjà d’être fermé.");
  recordSysPlusAudit(guild.id, interaction.user.id, "ticket.close", row.channel_id, { ticketId: row.id, reason });
  recordTicketEvent({ guildId: guild.id, ticketId: row.id, action: "closed", actorId: interaction.user.id });
  record("ticket_closed");
  await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "closed", row, [
    { name: "Raison", value: reason || "Aucune raison fournie", inline: false },
    { name: "Durée", value: ticketDuration(row.created_at), inline: true },
  ]));
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  const days = transcriptRetentionDays();
  if (channel && days) {
    // Opt-in transcript, captured before the channel is deleted. Failure never blocks the close.
    try {
      const rendered = renderTranscript(await fetchChannelMessages(channel));
      if (saveTranscript({ guildId: guild.id, ticketId: row.id, rendered, days })) record("ticket_transcript_saved");
    } catch { record("ticket_transcript_error"); }
  }
  if (channel) {
    await channel.send({ content: `🔒 Ticket fermé par ${mention(interaction.user.id)}.`, allowedMentions: { parse: [] } }).catch(() => {});
    await channel.delete(`Ticket #${row.id} fermé par ${interaction.user.tag}`).catch(() => {});
  }
  // Note du support demandée à l'auteur en MP (ne bloque jamais la fermeture).
  void askTicketRating(guild, row, interaction.user.id).then((asked) => { if (asked) record("ticket_rating_asked"); }).catch(() => {});
}

export async function handleTicketsInteraction(interaction, guildSettings = {}, { apiUrl, secret, record = () => {} } = {}) {
  if (interaction.isButton() && interaction.customId === "ticket:open") {
    return openTicket(interaction, guildSettings, record);
  }
  if (interaction.isButton() && (interaction.customId === "ticket:claim" || interaction.customId === "ticket:close")) {
    return ticketButton(interaction, guildSettings, record);
  }
  if (interaction.isButton() && interaction.customId === "ticket:templates") {
    return ticketTemplateButton(interaction, guildSettings);
  }
  if (interaction.isStringSelectMenu?.() && interaction.customId === "ticket:template:select") {
    return ticketTemplateSelect(interaction, guildSettings);
  }
  if (interaction.isModalSubmit?.() && interaction.customId === "ticket:template:modal") {
    return ticketTemplateModal(interaction, guildSettings, record);
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ticket") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Je ne trouve pas ton profil sur ce serveur.", ephemeral: true });
    return true;
  }
  const settings = guildSettings ?? {};
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "notes") {
      if (!isTicketStaff(member, settings)) throw new Error("Réservé au staff support.");
      await interaction.reply({ content: formatRatingStats(ratingStats(guild.id)), ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    if (subcommand === "panel") {
      if (!isTicketStaff(member, settings)) throw new Error("Permission Gérer les salons requise.");
      const setupIssue = ticketSetupIssue(settings.tickets);
      if (setupIssue) throw new Error(setupIssue);
      const supportRole = await guild.roles.fetch(settings.tickets.supportRoleId, { force: true }).catch(() => null);
      if (!supportRole || supportRole.id === guild.id || supportRole.managed) throw new Error("Le rôle support configuré est introuvable ou invalide. Corrige-le dans les réglages des tickets.");
      const channel = interaction.channel;
      if (!channel?.isTextBased()) throw new Error("Choisis un salon textuel existant pour publier le panneau.");
      await interaction.deferReply({ ephemeral: true });
      await channel.send({ embeds: [panelEmbed(settings, guild)], components: [panelButtons()], allowedMentions: { parse: [] } });
      await interaction.editReply({ content: `✅ Panneau de tickets publié dans <#${channel.id}>.` });
      record("ticket_panel");
      return true;
    }

    if (subcommand === "list") {
      if (!isTicketStaff(member, settings)) throw new Error("Réservé au staff.");
      const rows = db.prepare("SELECT * FROM tickets WHERE guild_id=? ORDER BY created_at DESC LIMIT 15").all(guild.id);
      const lines = rows.map((row) => `• \`#${row.id}\` <#${row.channel_id}> — ${ticketStatusLabel(row.status)} · ${mention(row.user_id)}${row.claimed_by ? ` · pris par ${mention(row.claimed_by)}` : ""} · ${ticketDuration(row.created_at)}`);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xe21d2f).setTitle("🎫 Tickets du serveur").setDescription(lines.length ? lines.join("\n") : "Aucun ticket.")],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (subcommand === "historique" || subcommand === "transcript") {
      if (!isTicketStaff(member, settings)) throw new Error("Réservé au staff.");
      const requested = interaction.options.getInteger("id") ?? ticketRow(interaction.channelId, guild.id)?.id ?? null;
      if (!requested) throw new Error("Indique l’identifiant du ticket ou utilise la commande dans son salon.");
      const target = db.prepare("SELECT id FROM tickets WHERE id=? AND guild_id=?").get(requested, guild.id);
      if (!target) throw new Error("Ticket introuvable sur ce serveur.");
      if (subcommand === "historique") {
        await interaction.reply({ content: formatTicketTimeline(target.id, listTicketEvents(guild.id, target.id)).slice(0, 1990), ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (!transcriptRetentionDays()) throw new Error("Les transcriptions sont désactivées sur ce bot (PND_TICKET_TRANSCRIPT_DAYS).");
      const transcript = getTranscript(guild.id, target.id);
      if (!transcript) throw new Error("Aucune transcription disponible (ticket ouvert, antérieur à l’activation ou rétention expirée).");
      recordSysPlusAudit(guild.id, interaction.user.id, "ticket.transcript_read", null, { ticketId: target.id });
      await interaction.reply({
        content: `📄 Transcription du ticket #${target.id} · ${transcript.messageCount} message(s)${transcript.truncated ? " (tronquée)" : ""} · supprimée <t:${Math.floor(transcript.expiresAt / 1000)}:R>.`,
        files: [new AttachmentBuilder(Buffer.from(transcript.content, "utf8"), { name: `ticket-${target.id}.txt` })],
        ephemeral: true,
      });
      return true;
    }

    const row = ticketRow(interaction.channelId, guild.id);
    if (!row || row.status !== "open") throw new Error("Cette commande doit être utilisée dans un salon de ticket ouvert.");
    const allowed = canActOnTicket({
      actorId: interaction.user.id,
      ticketUserId: row.user_id,
      claimedBy: row.claimed_by,
      isStaff: isTicketStaff(member, settings),
    });
    if (!allowed) throw new Error("Seul l’auteur du ticket ou le staff peut faire cela.");

    if (subcommand === "assign") {
      if (!isTicketStaff(member, settings)) throw new Error("Réservé au staff.");
      const user = interaction.options.getUser("membre", true);
      const assignee = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
      if (!assignee || assignee.user.bot || !isTicketStaff(assignee, settings)) throw new Error("Le ticket ne peut être assigné qu’à un membre du staff support.");
      const assigned = db.prepare("UPDATE tickets SET claimed_by=? WHERE id=? AND guild_id=? AND status='open'").run(assignee.id, row.id, guild.id);
      if (!Number(assigned.changes)) throw new Error("Ce ticket vient d’être fermé.");
      recordSysPlusAudit(guild.id, interaction.user.id, "ticket.assign", assignee.id, { ticketId: row.id });
      recordTicketEvent({ guildId: guild.id, ticketId: row.id, action: "assigned", actorId: interaction.user.id, targetId: assignee.id });
      await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "assigned", row, [{ name: "Assigné", value: mention(assignee.id), inline: true }]));
      await interaction.reply({ content: `👤 Ticket assigné à ${mention(assignee.id)}.`, allowedMentions: { users: [assignee.id] } });
      record("ticket_assigned");
      return true;
    }

    if (subcommand === "close") {
      const reason = sanitizeTicketSubject(interaction.options.getString("raison") ?? "", 300);
      await interaction.reply({ content: "🔒 Fermeture du ticket…", ephemeral: true });
      await closeTicket({ guild, settings, interaction, row, reason, record });
      return true;
    }

    if (subcommand === "add" || subcommand === "remove") {
      if (!isTicketStaff(member, settings) && row.user_id !== interaction.user.id) throw new Error("Réservé au staff ou à l’auteur du ticket.");
      const user = interaction.options.getUser("membre", true);
      if (user.bot) throw new Error("Impossible d’ajouter un bot au ticket.");
      if (user.id === row.user_id) throw new Error("Cette personne est déjà l’auteur du ticket.");
      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
      if (!channel) throw new Error("Salon du ticket introuvable.");
      if (subcommand === "add") {
        await channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
        }, { reason: `Ticket #${row.id} : ajout par ${interaction.user.tag}` });
        await interaction.reply({ content: `✅ ${mention(user.id)} a été ajouté au ticket.`, ephemeral: true, allowedMentions: { parse: [] } });
        recordSysPlusAudit(guild.id, interaction.user.id, "ticket.add", user.id, { ticketId: row.id });
        recordTicketEvent({ guildId: guild.id, ticketId: row.id, action: "member_added", actorId: interaction.user.id, targetId: user.id });
        await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "member_added", row, [{ name: "Membre ajouté", value: mention(user.id), inline: true }]));
        record("ticket_member_added");
      } else {
        await channel.permissionOverwrites.delete(user.id, `Ticket #${row.id} : retrait par ${interaction.user.tag}`).catch(() => {});
        await interaction.reply({ content: `✅ ${mention(user.id)} a été retiré du ticket.`, ephemeral: true, allowedMentions: { parse: [] } });
        recordSysPlusAudit(guild.id, interaction.user.id, "ticket.remove", user.id, { ticketId: row.id });
        recordTicketEvent({ guildId: guild.id, ticketId: row.id, action: "member_removed", actorId: interaction.user.id, targetId: user.id });
        await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "member_removed", row, [{ name: "Membre retiré", value: mention(user.id), inline: true }]));
        record("ticket_member_removed");
      }
      return true;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
  return true;
}


/**
 * Prefix adapter for the same ticket lifecycle. It reuses the slash handler so
 * authorization, SQL predicates, audit events and Discord permission checks
 * remain identical across both command surfaces.
 */
export async function handleTicketsMessage(message, guildSettings = {}, options = {}) {
  if (!message?.guild || !message?.member) return false;
  const parsed = parseTicketPrefixCommand(message.content, message.mentions?.users?.first?.()?.id ?? null);
  if (!parsed) return false;
  const { action } = parsed;
  if (action === "invalid") {
    await message.reply({ content: "Sous-commande inconnue. Utilise `=ticket help`.", allowedMentions: { parse: [] } });
    return true;
  }
  if (action === "help") {
    await message.reply({
      content: "**Tickets**\n`=ticket panel` — publier le panneau (staff)\n`=ticket list` — lister les tickets (staff)\n`=ticket close [raison]` — fermer le ticket courant\n`=ticket add @membre` / `=ticket remove @membre` — gérer les accès (staff)\n`=ticket assign @membre` — assigner (staff)\n`=ticket historique [id]` — historique (staff)\n`=ticket notes` — notes du support par modérateur (staff)",
      allowedMentions: { parse: [] },
    });
    return true;
  }
  if (action === "transcript") {
    await message.reply({ content: "📄 Les transcriptions ne sont disponibles qu’en commande slash (`/ticket transcript`), pour rester privées.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.error === "member_required") {
    await message.reply({ content: `Utilisation : \`=ticket ${action} @membre\`.`, allowedMentions: { parse: [] } });
    return true;
  }

  let acknowledgement = null;
  let deleteScheduled = false;
  const send = async (payload = {}) => {
    const data = typeof payload === "string" ? { content: payload } : { ...payload };
    const ephemeral = Boolean(data.ephemeral);
    delete data.ephemeral;
    const sent = acknowledgement ? await acknowledgement.edit(data) : await message.reply(data);
    acknowledgement = sent;
    if (ephemeral && !deleteScheduled) {
      deleteScheduled = true;
      const timer = setTimeout(() => sent.delete().catch(() => {}), 15_000);
      timer.unref?.();
    }
    return sent;
  };
  const adapter = {
    guild: message.guild,
    member: message.member,
    user: message.author,
    channel: message.channel,
    channelId: message.channelId,
    customId: null,
    deferred: false,
    replied: false,
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName: "ticket",
    options: {
      getSubcommand: () => action,
      getString: (name) => name === "raison" ? parsed.reason : null,
      getUser: (name) => name === "membre" && parsed.memberId ? message.mentions.users.first() : null,
      getInteger: (name) => (name === "id" ? parsed.ticketId : null),
    },
    deferReply: async (payload) => { adapter.deferred = true; await send({ content: "⏳ Traitement de la demande…", ...payload }); },
    reply: async (payload) => { adapter.replied = true; return send(payload); },
    editReply: async (payload) => { adapter.replied = true; return send(payload); },
  };
  return handleTicketsInteraction(adapter, guildSettings, options);
}

async function openTicket(interaction, guildSettings = {}, record = () => {}) {
  const guild = interaction.guild;
  const settings = guildSettings ?? {};
  const lockKey = `${guild?.id ?? ""}:${interaction.user.id}`;
  let lockAcquired = false;
  try {
    await interaction.deferReply({ ephemeral: true });
    if (!guild) throw new Error("Cette action doit être utilisée sur un serveur.");
    if (openingTickets.has(lockKey)) throw new Error("La création de ton ticket est déjà en cours. Patiente quelques secondes.");
    openingTickets.add(lockKey);
    lockAcquired = true;
    const setupIssue = ticketSetupIssue(settings.tickets);
    if (setupIssue) throw new Error(setupIssue);
    if (!ticketOpenAllowed(openTicketsFor(guild.id, interaction.user.id), settings.tickets.maxOpenPerUser)) {
      throw new Error("Tu as déjà un ticket ouvert. Ferme-le avant d’en ouvrir un autre.");
    }
    const member = interaction.member ?? await guild.members.fetch(interaction.user.id);
    const botMember = await guild.members.fetchMe();
    if (settings.tickets.supportRoleId) {
      const supportRole = await guild.roles.fetch(settings.tickets.supportRoleId, { force: true }).catch(() => null);
      if (!supportRole || supportRole.id === guild.id || supportRole.managed) {
        throw new Error("Le rôle du support configuré est introuvable ou invalide. Corrige-le dans les réglages des tickets.");
      }
    }
    if (!botMember.permissions.has(P.ManageChannels) || !botMember.permissions.has(P.ManageRoles)) {
      throw new Error("Je dois posséder les permissions Gérer les salons et Gérer les rôles pour créer un ticket privé.");
    }
    const parent = settings.tickets.categoryId
      ? await guild.channels.fetch(settings.tickets.categoryId).catch(() => null)
      : null;
    if (settings.tickets.categoryId && (!parent || parent.type !== ChannelType.GuildCategory || parent.guildId !== guild.id)) {
      throw new Error("La catégorie de tickets configurée est introuvable ou invalide. Corrige-la dans les réglages des tickets.");
    }
    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks],
      },
      {
        id: botMember.id,
        allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ManageMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks],
      },
    ];
    if (settings.tickets.supportRoleId) {
      permissionOverwrites.push({
        id: settings.tickets.supportRoleId,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages],
      });
    }
    const subject = "Demande d’assistance";
    const channel = await guild.channels.create({
      name: ticketChannelName(member.user.username, member.id),
      type: ChannelType.GuildText,
      parent: parent?.id,
      topic: `Ticket de ${member.user.tag} — ${subject}`,
      permissionOverwrites,
      reason: `Ticket ouvert par ${member.user.tag}`,
    });
    let ticketId;
    try {
      const createdAt = Date.now();
      const result = db.prepare("INSERT INTO tickets(guild_id,channel_id,user_id,subject,status,created_at) VALUES(?,?,?,?, 'open', ?)")
        .run(guild.id, channel.id, member.id, subject, createdAt);
      ticketId = Number(result.lastInsertRowid);
      const ticket = { id: ticketId, user_id: member.id, subject, created_at: createdAt };
      await channel.send({
        content: `${mention(member.id)}${settings.tickets.supportRoleId ? ` · <@&${settings.tickets.supportRoleId}>` : ""}`,
        embeds: [ticketWelcomeEmbed(ticket, member, settings)],
        components: [ticketButtons()],
        allowedMentions: { parse: [] },
      });
      recordSysPlusAudit(guild.id, member.id, "ticket.open", channel.id, { ticketId });
      recordTicketEvent({ guildId: guild.id, ticketId, action: "opened", actorId: member.id });
      await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "opened", ticket));
    } catch (creationError) {
      if (ticketId) db.prepare("UPDATE tickets SET status='failed', closed_at=? WHERE id=? AND guild_id=? AND status='open'").run(Date.now(), ticketId, guild.id);
      await channel.delete("Nettoyage : création du ticket incomplète").catch(() => {});
      throw new Error(`Le ticket n’a pas pu être initialisé : ${creationError instanceof Error ? creationError.message : "erreur Discord/SQLite"}`);
    }
    await interaction.editReply({ content: `🎫 Ton ticket est ouvert : <#${channel.id}>.`, allowedMentions: { parse: [] } });
    try { incrementDailyMetric(guild.id, "tickets_opened", 1); } catch { /* Ticket creation must not fail on analytics. */ }
    record("ticket_opened");
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Impossible d’ouvrir le ticket."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  } finally {
    if (lockAcquired) openingTickets.delete(lockKey);
  }
}

async function ticketButton(interaction, guildSettings = {}, record = () => {}) {
  const guild = interaction.guild;
  const settings = guildSettings ?? {};
  try {
    if (!guild) throw new Error("Cette action doit être utilisée sur un serveur.");
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) throw new Error("Je ne trouve pas ton profil sur ce serveur.");
    const row = ticketRow(interaction.channelId, guild.id);
    if (!row || row.status !== "open") throw new Error("Ce ticket est déjà fermé.");

    const staff = isTicketStaff(member, settings);
    if (interaction.customId === "ticket:claim") {
      if (!staff) throw new Error("Réservé au staff.");
      if (row.claimed_by && row.claimed_by !== interaction.user.id) throw new Error("Ce ticket est déjà pris en charge.");
      // Claim atomically: two staff members can click at the same time. The
      // previous read is only a friendly pre-check; this SQL condition is the
      // actual concurrency guard and prevents the second click overwriting the
      // first claimant.
      const claimed = db.prepare("UPDATE tickets SET claimed_by=? WHERE id=? AND guild_id=? AND status='open' AND (claimed_by IS NULL OR claimed_by=?)")
        .run(interaction.user.id, row.id, guild.id, interaction.user.id);
      if (!Number(claimed.changes)) throw new Error("Ce ticket vient d’être fermé ou modifié. Actualise le salon.");
      recordSysPlusAudit(guild.id, interaction.user.id, "ticket.claim", row.channel_id, { ticketId: row.id });
      recordTicketEvent({ guildId: guild.id, ticketId: row.id, action: "claimed", actorId: interaction.user.id });
      await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "claimed", row));
      await interaction.editReply({ content: "🙋 Tu prends en charge ce ticket." });
      record("ticket_claimed");
      return true;
    }

    const allowed = canActOnTicket({
      actorId: interaction.user.id,
      ticketUserId: row.user_id,
      claimedBy: row.claimed_by,
      isStaff: staff,
    });
    if (!allowed) throw new Error("Seul l’auteur du ticket ou le staff peut le fermer.");

    await interaction.editReply({ content: "🔒 Fermeture du ticket…" });
    await closeTicket({ guild, settings, interaction, row, reason: "Fermeture via le bouton", record });
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    await respondToInteraction(interaction, { content }, { ephemeral: true }).catch((responseError) => {
      console.error("[tickets] impossible de répondre à l’interaction:", responseError?.message ?? responseError);
    });
    return true;
  }
}

/** Maintient la base cohérente si un salon de ticket est supprimé à la main. */
export function handleTicketChannelDelete(channel, record = () => {}) {
  if (!channel.guild) return false;
  const row = db.prepare("SELECT id FROM tickets WHERE channel_id=? AND guild_id=? AND status='open'").get(channel.id, channel.guild.id);
  if (!row) return false;
  db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=?").run(Date.now(), row.id);
  recordTicketEvent({ guildId: channel.guild.id, ticketId: row.id, action: "channel_deleted" });
  record("ticket_closed");
  return true;
}

export function ticketSnapshot(guildId) {
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM tickets WHERE guild_id=? GROUP BY status").all(guildId);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}
