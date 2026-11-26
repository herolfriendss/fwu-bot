import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import { db, transaction } from "./database.js";
import { sendToLogsHub } from "./logs-hub.js";
import { systemLogEmbed } from "./logs.js";
import { chooseVoiceRequestDestination, isVoiceAccessEntryPointContext } from "./voice-access-policy.js";
import { removeVoiceAccessBlock } from "./voice-access-store.js";

const P = PermissionFlagsBits;
const REQUEST_TTL_MS = 10 * 60_000;
const REQUEST_COOLDOWN_MS = 5 * 60_000;
const BLOCK_COOLDOWN_MS = 24 * 60 * 60_000;

function isSnowflake(value) {
  return typeof value === "string" && /^\d{5,25}$/.test(value);
}

function requestButtons(requestId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vreq:${requestId}:accept`).setLabel("Accepter").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`vreq:${requestId}:reject`).setLabel("Refuser").setEmoji("✖️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vreq:${requestId}:block`).setLabel("Bloquer").setEmoji("🚫").setStyle(ButtonStyle.Danger),
  )];
}

function requestEntryPointButtons(channelId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vreq:start:${channelId}`)
      .setLabel("Demander l'accès")
      .setEmoji("🔑")
      .setStyle(ButtonStyle.Primary),
  )];
}

/** Publishes a request entry point in a voice channel's native text chat when
 * the installed discord.js/API channel object exposes a usable text surface.
 * A failure is deliberately non-fatal: the configured request hub remains
 * the fallback for hidden channels and clients without voice-chat support.
 */
export async function publishVoiceAccessEntryPoint(channel, botMember) {
  if (!channel || channel.type !== ChannelType.GuildVoice || !channel.client?.rest?.post) {
    return { published: false, reason: "voice_chat_unavailable" };
  }
  const permissions = channel.permissionsFor?.(botMember);
  if (!permissions?.has(P.ViewChannel) || !permissions?.has(P.SendMessages) || !permissions?.has(P.ReadMessageHistory)) {
    return { published: false, reason: "missing_permissions" };
  }
  try {
    // Discord's voice-channel chat uses the channel messages endpoint even
    // though discord.js does not expose GuildVoiceChannel as TextBasedChannel.
    const embed = new EmbedBuilder()
      .setColor(0xe21d2f)
      .setTitle("🔒 Vocale privée")
      .setDescription("Tu souhaites rejoindre cette vocale ? Envoie une demande au propriétaire. Il pourra l'accepter, la refuser ou bloquer les demandes.")
      .setFooter({ text: "PND Voice Access • Les demandes expirent après 10 minutes" });
    await channel.client.rest.post(Routes.channelMessages(channel.id), {
      body: {
        embeds: [embed.toJSON()],
        components: requestEntryPointButtons(channel.id).map((row) => row.toJSON()),
        allowed_mentions: { parse: [] },
      },
    });
    return { published: true };
  } catch (error) {
    return { published: false, reason: String(error?.message ?? "send_failed").slice(0, 120) };
  }
}

function logAccessEvent(client, guild, title, description, color = 0xe21d2f) {
  const embed = systemLogEmbed({ title, description, color });
  void sendToLogsHub(client, guild, embed, title).catch(() => {});
}

/** Called when =pv locks a channel. Temp-voice ownership is preferred over the actor who pressed the lock. */
export function registerPrivateVoiceChannel({ guildId, channelId, ownerUserId, source = "pv", now = Date.now() }) {
  if (![guildId, channelId, ownerUserId].every(isSnowflake)) throw new Error("Identifiants vocaux invalides.");
  db.prepare(`INSERT INTO voice_private_channels(guild_id,channel_id,owner_user_id,source,active,created_at,updated_at)
    VALUES(?,?,?,?,1,?,?)
    ON CONFLICT(guild_id,channel_id) DO UPDATE SET owner_user_id=excluded.owner_user_id,
      source=excluded.source,active=1,updated_at=excluded.updated_at`)
    .run(guildId, channelId, ownerUserId, source, now, now);
}

export function deactivatePrivateVoiceChannel({ guildId, channelId, now = Date.now() }) {
  transaction(() => {
    db.prepare("UPDATE voice_private_channels SET active=0,updated_at=? WHERE guild_id=? AND channel_id=?")
      .run(now, guildId, channelId);
    db.prepare("UPDATE voice_access_requests SET status='cancelled',decided_at=?,decision_note='Vocal déverrouillé' WHERE guild_id=? AND channel_id=? AND status IN ('pending','processing')")
      .run(now, guildId, channelId);
  });
}

function resolveVoiceChannel(message, rawTarget) {
  const mentioned = message.mentions?.channels?.first?.();
  if (mentioned?.type === ChannelType.GuildVoice) return mentioned;
  if (message.channel?.type === ChannelType.GuildVoice) return message.channel;
  const id = String(rawTarget ?? "").match(/^(?:<#)?(\d{5,25})>?$/)?.[1];
  if (!id) return null;
  return message.guild.channels.fetch(id).catch(() => null);
}

export async function handleVoiceAccessRequestMessage(message, rawSettings = {}) {
  if (!message?.guild || !message.member) return true;
  const parts = String(message.content ?? "").trim().split(/\s+/);
  if (parts[1]?.toLowerCase() === "debloquer") {
    const channel = await resolveVoiceChannel(message, parts[2]);
    const targetId = parts[3]?.match(/^<@!?(\d{5,25})>$/)?.[1] ?? parts[3];
    if (!channel || channel.type !== ChannelType.GuildVoice || !isSnowflake(targetId)) {
      await message.reply({ content: "Utilisation : `=demandevocal debloquer <#vocale> <@membre>`.", allowedMentions: { parse: [] } });
      return true;
    }
    const result = removeVoiceAccessBlock({
      guildId: message.guild.id, channelId: channel.id, userId: targetId, actorId: message.author.id,
      authorizeActor: ({ actorId }) => actorId === message.guild.ownerId || message.member.permissions?.has?.(P.ManageChannels) === true || message.member.permissions?.has?.(P.Administrator) === true,
    });
    await message.reply({ content: result.removed ? `✅ <@${targetId}> peut à nouveau demander l'accès à **${channel.name}**.` : "Ce membre n'était pas bloqué sur cette vocale.", allowedMentions: { parse: [] } });
    return true;
  }
  const channel = await resolveVoiceChannel(message, parts[1]);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await message.reply({ content: "Utilisation : `=demandevocal #salon-vocal` — tu peux aussi utiliser cette commande depuis le chat de la vocale.", allowedMentions: { parse: [] } });
    return true;
  }

  const config = db.prepare(`SELECT owner_user_id FROM voice_private_channels
    WHERE guild_id=? AND channel_id=? AND active=1`).get(message.guild.id, channel.id);
  if (!config) {
    await message.reply({ content: "Cette vocale n'est pas enregistrée comme privée par le bot. Son propriétaire doit d'abord la verrouiller avec `=pv`.", allowedMentions: { parse: [] } });
    return true;
  }

  const requesterId = message.author.id;
  const ownerId = config.owner_user_id;
  if (requesterId === ownerId) {
    await message.reply({ content: "Tu es déjà propriétaire de cette vocale.", allowedMentions: { parse: [] } });
    return true;
  }
  if (channel.permissionsFor(message.member)?.has(P.Connect)) {
    await message.reply({ content: "Tu possèdes déjà l'accès à cette vocale.", allowedMentions: { parse: [] } });
    return true;
  }
  const blocked = db.prepare("SELECT 1 FROM voice_access_blocks WHERE guild_id=? AND channel_id=? AND user_id=?")
    .get(message.guild.id, channel.id, requesterId);
  if (blocked) {
    await message.reply({ content: "⛔ Le propriétaire a bloqué les demandes d'accès pour toi sur cette vocale.", allowedMentions: { parse: [] } });
    return true;
  }

  const now = Date.now();
  const pending = db.prepare(`SELECT request_id,expires_at FROM voice_access_requests
    WHERE guild_id=? AND channel_id=? AND requester_id=? AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1`).get(message.guild.id, channel.id, requesterId);
  if (pending && Number(pending.expires_at) > now) {
    await message.reply({ content: "⏳ Tu as déjà une demande en attente pour cette vocale.", allowedMentions: { parse: [] } });
    return true;
  }
  if (pending) db.prepare("UPDATE voice_access_requests SET status='expired',decided_at=?,decision_note='Expiration automatique' WHERE request_id=? AND status IN ('pending','processing')").run(now, pending.request_id);

  const recent = db.prepare(`SELECT status,created_at FROM voice_access_requests
    WHERE guild_id=? AND channel_id=? AND requester_id=? ORDER BY created_at DESC LIMIT 1`)
    .get(message.guild.id, channel.id, requesterId);
  if (recent) {
    const cooldown = recent.status === "blocked" ? BLOCK_COOLDOWN_MS : REQUEST_COOLDOWN_MS;
    const remaining = cooldown - (now - Number(recent.created_at));
    if (remaining > 0) {
      await message.reply({ content: `⌛ Tu pourras refaire une demande dans environ ${Math.ceil(remaining / 60_000)} minute(s).`, allowedMentions: { parse: [] } });
      return true;
    }
  }

  const botMember = message.guild.members.me ?? await message.guild.members.fetchMe();
  const ownerMember = await message.guild.members.fetch({ user: ownerId, force: true }).catch(() => null);
  const requestChannel = chooseVoiceRequestDestination({
    guild: message.guild,
    voiceChannel: channel,
    requester: message.member,
    bot: botMember,
    configuredChannelId: rawSettings?.voiceAccess?.requestChannelId ?? null,
  });
  if (!requestChannel || !ownerMember || requestChannel.permissionsFor(ownerMember)?.has(P.ViewChannel) !== true) {
    await message.reply({ content: "Je n'ai pas trouvé de salon texte accessible au demandeur, au propriétaire et au bot. Configure `requestChannelId` vers un salon `#demandes-vocales` où les trois peuvent voir les messages, et où le bot peut envoyer des messages et intégrer des liens.", allowedMentions: { parse: [] } });
    return true;
  }

  const requestId = randomUUID().replaceAll("-", "").slice(0, 24);
  const expiresAt = now + REQUEST_TTL_MS;
  db.prepare(`INSERT INTO voice_access_requests
    (request_id,guild_id,channel_id,requester_id,owner_user_id,status,request_channel_id,created_at,expires_at)
    VALUES(?,?,?,?,?,'pending',?,?,?)`)
    .run(requestId, message.guild.id, channel.id, requesterId, ownerId, requestChannel.id, now, expiresAt);

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🔔 Nouvelle demande d'accès vocal")
    .setDescription(`<@${requesterId}> souhaite rejoindre **${channel.name}**.`)
    .addFields(
      { name: "Demandeur", value: `<@${requesterId}>`, inline: true },
      { name: "Vocale", value: `<#${channel.id}>`, inline: true },
      { name: "Décision", value: `Seul le propriétaire <@${ownerId}> ou un responsable ayant Gérer les salons peut décider.` },
      { name: "Expiration", value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `PND Voice Access • Demande ${requestId} • Vocal ${channel.id}` })
    .setTimestamp(new Date(now));

  try {
    const requestMessage = await requestChannel.send({
      content: `<@${ownerId}> • nouvelle demande d'accès`,
      embeds: [embed],
      components: requestButtons(requestId),
      allowedMentions: { parse: [], users: [ownerId] },
    });
    db.prepare("UPDATE voice_access_requests SET message_id=? WHERE request_id=? AND status='pending'")
      .run(requestMessage.id, requestId);
    logAccessEvent(message.client, message.guild, "🎙️ Demande d'accès vocal", `Demandeur : <@${requesterId}>\nPropriétaire : <@${ownerId}>\nVocale : <#${channel.id}>\nÉtat : en attente`);
    await message.reply({ content: `✅ Ta demande a été transmise au propriétaire de **${channel.name}**. Elle expire dans 10 minutes.`, allowedMentions: { parse: [] } });
  } catch (error) {
    db.prepare("DELETE FROM voice_access_requests WHERE request_id=? AND status='pending'").run(requestId);
    await message.reply({ content: `❌ Je n'ai pas pu publier la demande dans le chat vocal : ${String(error?.message ?? "erreur Discord").slice(0, 180)}`, allowedMentions: { parse: [] } });
  }
  return true;
}

export async function handleVoiceAccessRequestInteraction(interaction, rawSettings = {}) {
  if (!interaction?.isButton?.() || !String(interaction.customId).startsWith("vreq:")) return false;
  const [, requestId, action] = interaction.customId.split(":");
  if (requestId === "start") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette demande doit être faite depuis un serveur.", ephemeral: true });
      return true;
    }
    if (!isSnowflake(action)) {
      await interaction.reply({ content: "Ce bouton de demande est invalide.", ephemeral: true });
      return true;
    }
    const channel = await interaction.guild.channels.fetch(action).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await interaction.reply({ content: "Cette vocale privée n'existe plus.", ephemeral: true });
      return true;
    }
    // Accept only the original bot-authored entry point in its own voice
    // channel. This rejects copied components, forged custom IDs and reposts.
    const validEntryPoint = isVoiceAccessEntryPointContext({
      customId: interaction.customId,
      channelId: interaction.channelId,
      messageChannelId: interaction.message?.channelId,
      messageAuthorId: interaction.message?.author?.id,
      botUserId: interaction.client?.user?.id,
    });
    if (!validEntryPoint || interaction.channelId !== channel.id) {
      await interaction.reply({ content: "Utilise le bouton officiel depuis le chat de la vocale concernée.", ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: "Impossible de vérifier ton profil serveur." });
      return true;
    }
    const adaptedMessage = {
      guild: interaction.guild,
      member,
      author: interaction.user,
      client: interaction.client,
      channel,
      content: `=demandevocal <#${channel.id}>`,
      mentions: { channels: { first: () => null } },
      reply: (payload) => interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
    };
    await handleVoiceAccessRequestMessage(adaptedMessage, rawSettings);
    return true;
  }
  const row = db.prepare("SELECT * FROM voice_access_requests WHERE request_id=?").get(requestId);
  if (!row || !interaction.guild || row.guild_id !== interaction.guild.id) {
    await interaction.reply({ content: "Cette demande n'existe plus ou appartient à un autre serveur.", ephemeral: true });
    return true;
  }
  if (interaction.channelId !== row.request_channel_id || interaction.message?.id !== row.message_id) {
    await interaction.reply({ content: "Ce bouton ne correspond pas au message de demande enregistré.", ephemeral: true });
    return true;
  }
  if (!new Set(["accept", "reject", "block"]).has(action)) {
    await interaction.reply({ content: "Action de demande inconnue.", ephemeral: true });
    return true;
  }

  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor) {
    await interaction.reply({ content: "Impossible de vérifier ton profil serveur.", ephemeral: true });
    return true;
  }
  const isOwner = actor.id === row.owner_user_id || actor.id === interaction.guild.ownerId;
  const isVoiceManager = actor.permissions.has(P.ManageChannels) || actor.permissions.has(P.Administrator);
  if (!isOwner && !isVoiceManager) {
    await interaction.reply({ content: "⛔ Seul le propriétaire de la vocale ou un responsable avec Gérer les salons peut traiter cette demande.", ephemeral: true });
    return true;
  }
  if (row.status !== "pending") {
    await interaction.reply({ content: `Cette demande est déjà traitée (${row.status}).`, ephemeral: true });
    return true;
  }
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("UPDATE voice_access_requests SET status='expired',decided_at=? WHERE request_id=? AND status='pending'").run(Date.now(), requestId);
    await interaction.reply({ content: "⌛ Cette demande a expiré.", ephemeral: true });
    return true;
  }
  const claimed = db.prepare("UPDATE voice_access_requests SET status='processing' WHERE request_id=? AND status='pending'").run(requestId);
  if (!Number(claimed.changes)) {
    await interaction.reply({ content: "Cette demande vient d'être prise en charge par quelqu'un d'autre.", ephemeral: true });
    return true;
  }

  const channel = await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
  const requester = await interaction.guild.members.fetch({ user: row.requester_id, force: true }).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice || !requester) {
    db.prepare("UPDATE voice_access_requests SET status='cancelled',decided_by=?,decided_at=?,decision_note='Membre ou vocale indisponible' WHERE request_id=? AND status='processing'")
      .run(actor.id, Date.now(), requestId);
    await interaction.reply({ content: "Le membre ou la vocale n'est plus disponible. La demande a été annulée.", ephemeral: true });
    return true;
  }
  if (action === "accept" || action === "block") {
    let botMember;
    try {
      botMember = await interaction.guild.members.fetchMe();
    } catch {
      db.prepare("UPDATE voice_access_requests SET status='pending' WHERE request_id=? AND status='processing'").run(requestId);
      await interaction.reply({ content: "Je n'arrive pas à vérifier mes permissions sur ce serveur. Réessaie dans un instant.", ephemeral: true });
      return true;
    }
    const botPermissions = channel.permissionsFor(botMember);
    if (!botPermissions?.has(P.ManageRoles) && !botMember.permissions.has(P.Administrator)) {
      db.prepare("UPDATE voice_access_requests SET status='pending' WHERE request_id=? AND status='processing'").run(requestId);
      await interaction.reply({ content: "Je dois avoir Gérer les rôles (ou Administrateur) pour modifier les permissions de cette vocale.", ephemeral: true });
      return true;
    }
    if (requester.id === botMember.id || requester.id === interaction.guild.ownerId || requester.permissions.has(P.Administrator)) {
      db.prepare("UPDATE voice_access_requests SET status='pending' WHERE request_id=? AND status='processing'").run(requestId);
      await interaction.reply({ content: "Ce membre dispose déjà d'un accès prioritaire Discord ; aucune modification individuelle n'est nécessaire.", ephemeral: true });
      return true;
    }
    try {
      if (action === "accept") {
        await channel.permissionOverwrites.edit(requester, { ViewChannel: true, Connect: true }, `PND Voice Access accepté par ${actor.id}`);
      } else {
        await channel.permissionOverwrites.edit(requester, { ViewChannel: true, Connect: false }, `PND Voice Access bloqué par ${actor.id}`);
      }
    } catch (error) {
      db.prepare("UPDATE voice_access_requests SET status='pending' WHERE request_id=? AND status='processing'").run(requestId);
      await interaction.reply({ content: `Discord a refusé la modification des accès : ${String(error?.message ?? "erreur").slice(0, 180)}`, ephemeral: true });
      return true;
    }
  }

  const status = action === "accept" ? "accepted" : action === "block" ? "blocked" : "rejected";
  const note = action === "accept" ? "Accès accordé" : action === "block" ? "Accès bloqué" : "Demande refusée";
  const decidedAt = Date.now();
  const changed = transaction(() => {
    const updated = db.prepare(`UPDATE voice_access_requests
      SET status=?,decided_by=?,decided_at=?,decision_note=?
      WHERE request_id=? AND status='processing'`).run(status, actor.id, decidedAt, note, requestId);
    if (!Number(updated.changes)) return false;
    if (action === "block") {
      db.prepare(`INSERT INTO voice_access_blocks(guild_id,channel_id,user_id,blocked_by,reason,created_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,channel_id,user_id) DO UPDATE SET blocked_by=excluded.blocked_by,reason=excluded.reason,created_at=excluded.created_at`)
        .run(row.guild_id, row.channel_id, row.requester_id, actor.id, "Blocage depuis PND Voice Access", decidedAt);
    }
    return true;
  });
  if (!changed) {
    await interaction.reply({ content: "La demande a changé d'état pendant le traitement. Vérifie les accès du membre.", ephemeral: true });
    return true;
  }

  await interaction.reply({
    content: action === "accept" ? `✅ Accès accordé à <@${row.requester_id}> dans <#${row.channel_id}>.`
      : action === "block" ? `🚫 <@${row.requester_id}> a été bloqué sur cette vocale.`
        : `✖️ La demande de <@${row.requester_id}> a été refusée. Aucun accès n'a été modifié.`,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  await interaction.message.edit({ components: [] }).catch(() => {});
  logAccessEvent(interaction.client, interaction.guild, "🎙️ Décision d'accès vocal", `Demandeur : <@${row.requester_id}>\nDécideur : <@${actor.id}>\nVocale : <#${row.channel_id}>\nDécision : ${note}`, action === "block" ? 0xef4444 : action === "accept" ? 0x22c55e : 0x64748b);
  return true;
}

export function voiceAccessRequestCooldowns() {
  return { requestTtlMs: REQUEST_TTL_MS, requestCooldownMs: REQUEST_COOLDOWN_MS, blockCooldownMs: BLOCK_COOLDOWN_MS };
}
