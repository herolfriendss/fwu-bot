// Her? V4 — tickets staff : panneau, ouverture, prise en charge et clôture.
//
// Chaque ticket possède son propre salon et sa ligne SQLite, indexée par
// serveur. Les permissions sont revérifiées à chaque bouton et commande.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
} from "discord.js";
import { db } from "./database.js";
import { updateModuleSettings } from "./module-settings.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import {
  canActOnTicket, sanitizeTicketSubject, ticketChannelName, ticketDuration, ticketOpenAllowed, ticketStatusLabel,
} from "./tickets-policy.js";

const P = PermissionFlagsBits;

function mention(id) { return `<@${id}>`; }

function isTicketStaff(member, settings) {
  if (!member?.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(P.Administrator) || member.permissions.has(P.ManageChannels)) return true;
  const roleIds = [settings?.tickets?.supportRoleId, settings?.sysPlus?.roleId].filter(Boolean);
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function ticketRow(channelId, guildId) {
  return db.prepare("SELECT * FROM tickets WHERE channel_id=? AND guild_id=?").get(channelId, guildId) ?? null;
}

function openTicketsFor(guildId, userId) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE guild_id=? AND user_id=? AND status='open'").get(guildId, userId).count);
}

async function sendTicketLog(guild, settings, embed) {
  const channelId = settings?.tickets?.logChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

function ticketLogEmbed(guild, interaction, action, ticket, extra = []) {
  return new EmbedBuilder()
    .setColor(action === "closed" ? 0x6b7280 : 0x5865f2)
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
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );
}

function panelEmbed(settings) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫 Support")
    .setDescription(settings?.tickets?.supportRoleId
      ? "Besoin d’aide ? Clique sur le bouton ci-dessous. Un membre du staff te répondra."
      : "Besoin d’aide ? Clique sur le bouton ci-dessous pour ouvrir un ticket privé.")
    .setFooter({ text: "Un seul ticket ouvert à la fois par défaut." });
}

function ticketWelcomeEmbed(ticket, member, settings) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎫 Ticket #${ticket.id}`)
    .setDescription("Décris ta demande ici. Un membre du staff va te répondre.\nUtilise **Fermer** quand tout est réglé.")
    .addFields(
      { name: "Auteur", value: mention(member.id), inline: true },
      { name: "Sujet", value: ticket.subject, inline: true },
      { name: "Support", value: settings?.tickets?.supportRoleId ? `<@&${settings.tickets.supportRoleId}>` : "Staff du serveur", inline: true },
    );
}

async function closeTicket({ guild, settings, interaction, row, reason, record }) {
  db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=? AND guild_id=? AND status='open'")
    .run(Date.now(), row.id, guild.id);
  recordSysPlusAudit(guild.id, interaction.user.id, "ticket.close", row.channel_id, { ticketId: row.id, reason });
  record("ticket_closed");
  await sendTicketLog(guild, settings, ticketLogEmbed(guild, interaction, "closed", row, [
    { name: "Raison", value: reason || "Aucune raison fournie", inline: false },
    { name: "Durée", value: ticketDuration(row.created_at), inline: true },
  ]));
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (channel) {
    await channel.send({ content: `🔒 Ticket fermé par ${mention(interaction.user.id)}.`, allowedMentions: { parse: [] } }).catch(() => {});
    await channel.delete(`Ticket #${row.id} fermé par ${interaction.user.tag}`).catch(() => {});
  }
}

export async function handleTicketsInteraction(interaction, guildSettings = {}, { apiUrl, secret, record = () => {} } = {}) {
  if (interaction.isButton() && interaction.customId === "ticket:open") {
    return openTicket(interaction, guildSettings, record);
  }
  if (interaction.isButton() && (interaction.customId === "ticket:claim" || interaction.customId === "ticket:close")) {
    return ticketButton(interaction, guildSettings, record);
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
    if (subcommand === "panel") {
      if (!isTicketStaff(member, settings)) throw new Error("Permission Gérer les salons requise.");
      await interaction.deferReply({ ephemeral: true });
      if (!settings.tickets?.enabled) {
        const saved = await updateModuleSettings({
          apiUrl,
          secret,
          guildId: guild.id,
          module: "tickets",
          value: {
            ...(settings.tickets ?? {}),
            enabled: true,
            categoryId: settings.tickets?.categoryId ?? interaction.channel?.parentId ?? null,
          },
          actorId: interaction.user.id,
        });
        settings.tickets = saved.tickets;
      }
      const channel = interaction.channel;
      if (!channel?.isTextBased()) throw new Error("Choisis un salon textuel.");
      await channel.send({ embeds: [panelEmbed(settings)], components: [panelButtons()], allowedMentions: { parse: [] } });
      await interaction.editReply({ content: `✅ Panneau de tickets publié dans <#${channel.id}>.` });
      record("ticket_panel");
      return true;
    }

    if (subcommand === "list") {
      if (!isTicketStaff(member, settings)) throw new Error("Réservé au staff.");
      const rows = db.prepare("SELECT * FROM tickets WHERE guild_id=? ORDER BY created_at DESC LIMIT 15").all(guild.id);
      const lines = rows.map((row) => `• \`#${row.id}\` <#${row.channel_id}> — ${ticketStatusLabel(row.status)} · ${mention(row.user_id)}${row.claimed_by ? ` · pris par ${mention(row.claimed_by)}` : ""} · ${ticketDuration(row.created_at)}`);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎫 Tickets du serveur").setDescription(lines.length ? lines.join("\n") : "Aucun ticket.")],
        ephemeral: true,
        allowedMentions: { parse: [] },
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
        record("ticket_member_added");
      } else {
        await channel.permissionOverwrites.delete(user.id, `Ticket #${row.id} : retrait par ${interaction.user.tag}`).catch(() => {});
        await interaction.reply({ content: `✅ ${mention(user.id)} a été retiré du ticket.`, ephemeral: true, allowedMentions: { parse: [] } });
        recordSysPlusAudit(guild.id, interaction.user.id, "ticket.remove", user.id, { ticketId: row.id });
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

async function openTicket(interaction, guildSettings = {}, record = () => {}) {
  const guild = interaction.guild;
  const settings = guildSettings ?? {};
  try {
    await interaction.deferReply({ ephemeral: true });
    if (!settings.tickets?.enabled) throw new Error("Les tickets ne sont pas activés sur ce serveur.");
    if (!ticketOpenAllowed(openTicketsFor(guild.id, interaction.user.id), settings.tickets.maxOpenPerUser)) {
      throw new Error("Tu as déjà un ticket ouvert. Ferme-le avant d’en ouvrir un autre.");
    }
    const member = interaction.member ?? await guild.members.fetch(interaction.user.id);
    const parent = settings.tickets.categoryId
      ? await guild.channels.fetch(settings.tickets.categoryId).catch(() => null)
      : null;
    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks],
      },
      {
        id: guild.members.me?.id ?? guild.client.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ReadMessageHistory],
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
    const result = db.prepare("INSERT INTO tickets(guild_id,channel_id,user_id,subject,status,created_at) VALUES(?,?,?,?, 'open', ?)")
      .run(guild.id, channel.id, member.id, subject, Date.now());
    const ticket = { id: Number(result.lastInsertRowid), user_id: member.id, subject, created_at: Date.now() };
    recordSysPlusAudit(guild.id, member.id, "ticket.open", channel.id, { ticketId: ticket.id });
    await channel.send({
      content: `${mention(member.id)}${settings.tickets.supportRoleId ? ` · <@&${settings.tickets.supportRoleId}>` : ""}`,
      embeds: [ticketWelcomeEmbed(ticket, member, settings)],
      components: [ticketButtons()],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    await interaction.editReply({ content: `🎫 Ton ticket est ouvert : <#${channel.id}>.`, allowedMentions: { parse: [] } });
    record("ticket_opened");
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Impossible d’ouvrir le ticket."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
}

async function ticketButton(interaction, guildSettings = {}, record = () => {}) {
  const guild = interaction.guild;
  const settings = guildSettings ?? {};
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  const row = ticketRow(interaction.channelId, guild.id);
  try {
    if (!row || row.status !== "open") throw new Error("Ce ticket est déjà fermé.");
    const staff = isTicketStaff(member, settings);
    if (interaction.customId === "ticket:claim") {
      if (!staff) throw new Error("Réservé au staff.");
      if (row.claimed_by && row.claimed_by !== interaction.user.id) throw new Error("Ce ticket est déjà pris en charge.");
      db.prepare("UPDATE tickets SET claimed_by=? WHERE id=? AND guild_id=?").run(interaction.user.id, row.id, guild.id);
      recordSysPlusAudit(guild.id, interaction.user.id, "ticket.claim", row.channel_id, { ticketId: row.id });
      await interaction.reply({ content: "🙋 Tu prends en charge ce ticket.", ephemeral: true });
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
    await interaction.reply({ content: "🔒 Fermeture du ticket…", ephemeral: true });
    await closeTicket({ guild, settings, interaction, row, reason: "Fermeture via le bouton", record });
    return true;
  } catch (error) {
    await interaction.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, ephemeral: true }).catch(() => {});
    return true;
  }
}

/** Maintient la base cohérente si un salon de ticket est supprimé à la main. */
export function handleTicketChannelDelete(channel, record = () => {}) {
  if (!channel.guild) return false;
  const row = db.prepare("SELECT id FROM tickets WHERE channel_id=? AND guild_id=? AND status='open'").get(channel.id, channel.guild.id);
  if (!row) return false;
  db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=?").run(Date.now(), row.id);
  record("ticket_closed");
  return true;
}

export function ticketSnapshot(guildId) {
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM tickets WHERE guild_id=? GROUP BY status").all(guildId);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}
