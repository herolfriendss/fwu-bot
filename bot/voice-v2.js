// Her? V4 — Vocal V2 : hub « rejoindre pour créer » et salons temporaires.
//
// Chaque salon créé est enregistré dans SQLite avec son serveur et son
// propriétaire. Il est supprimé dès qu’il devient vide, sauf suppression
// manuelle par le propriétaire ou le staff.
import { ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db } from "./database.js";
import { canManageTempVoice, clampVoiceLimit, renderVoiceName, tempVoiceNameIsValid } from "./voice-v2-policy.js";
import { herBotAvatar, themePanelEmbed } from "./theme.js";
import { handleVoiceAccessRequestMessage } from "./voice-access-requests.js";
import { handleVoiceMessage, lockPrivateVoiceChannel, unlockPrivateVoiceChannel } from "./voice-commands.js";
import { removeVoiceAccessBlock } from "./voice-access-store.js";

const P = PermissionFlagsBits;

function tempRow(channelId) {
  return db.prepare("SELECT * FROM temp_voice WHERE channel_id=?").get(channelId) ?? null;
}

function ownerRow(guildId, ownerId) {
  return db.prepare("SELECT * FROM temp_voice WHERE guild_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 1").get(guildId, ownerId) ?? null;
}

function overwrites(guild, ownerId) {
  return [
    {
      id: guild.roles.everyone.id,
      allow: [P.Connect, P.Speak],
    },
    {
      id: ownerId,
      allow: [P.Connect, P.Speak, P.ManageChannels, P.MoveMembers, P.MuteMembers, P.DeafenMembers],
    },
    {
      id: guild.members.me?.id ?? guild.client.user.id,
      allow: [P.Connect, P.Speak, P.ManageChannels, P.MoveMembers],
    },
  ];
}

export async function handleVoiceV2State(oldState, newState, settings, record = () => {}) {
  const guild = newState.guild ?? oldState.guild;
  if (!guild) return false;
  const config = settings?.tempVoice;

  // 1. Arrivée dans le hub : création du salon personnel.
  if (config?.enabled && config.hubChannelId && newState.channelId === config.hubChannelId && !newState.member?.user.bot) {
    try {
      const existing = ownerRow(guild.id, newState.id);
      if (existing) {
        const channel = await guild.channels.fetch(existing.channel_id).catch(() => null);
        if (channel) {
          await newState.setChannel(channel, "Vocal V2 : retour dans le salon personnel").catch(() => {});
          return true;
        }
        db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(existing.channel_id);
      }
      const channel = await guild.channels.create({
        name: renderVoiceName(config.nameTemplate, newState.member.displayName),
        type: ChannelType.GuildVoice,
        parent: config.categoryId ?? undefined,
        userLimit: clampVoiceLimit(config.defaultLimit),
        permissionOverwrites: overwrites(guild, newState.id),
        reason: `Vocal V2 : salon de ${newState.member.user.tag}`,
      });
      db.prepare("INSERT INTO temp_voice(channel_id,guild_id,owner_id,created_at) VALUES(?,?,?,?)").run(channel.id, guild.id, newState.id, Date.now());
      await newState.setChannel(channel, "Vocal V2 : salon personnel").catch(() => {});
      record("temp_voice_created");
      return true;
    } catch {
      record("temp_voice_error");
      return false;
    }
  }

  // 2. Départ d’un salon temporaire : nettoyage s’il est vide.
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const row = tempRow(oldState.channelId);
    if (!row) return false;
    try {
      const channel = await guild.channels.fetch(oldState.channelId).catch(() => null);
      if (!channel) {
        db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(oldState.channelId);
        return false;
      }
      if (channel.members.size === 0) {
        db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(channel.id);
        await channel.delete("Vocal V2 : salon temporaire vide").catch(() => {});
        record("temp_voice_deleted");
        return true;
      }
    } catch {
      record("temp_voice_error");
    }
  }
  return false;
}


/** Réconcilie les salons temporaires persistés après un redémarrage.
 * Les lignes orphelines sont supprimées ; les salons existants restent intacts.
 */
export async function reconcileTempVoices(client, record = () => {}) {
  const rows = db.prepare("SELECT channel_id,guild_id FROM temp_voice").all();
  let removed = 0;
  let emptiedDeleted = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue; // serveur momentanément indisponible : conserver la ligne
    // Only "Unknown Channel" (10003) proves deletion; any other error is transient
    // and must not drop the row (the channel would then stay orphaned forever).
    const channel = await guild.channels.fetch(row.channel_id).catch((error) => (error?.code === 10003 ? null : undefined));
    if (channel === undefined) continue;
    if (!channel) {
      db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(row.channel_id);
      removed++;
      continue;
    }
    // Emptied while the bot was offline: the leave event was missed, clean it now.
    if (channel.members?.size === 0) {
      try {
        await channel.delete("Vocal V2 : salon temporaire vidé pendant l'arrêt du bot");
        db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(row.channel_id);
        emptiedDeleted++;
      } catch { record("temp_voice_error"); }
    }
  }
  if (removed) record("temp_voice_orphans_cleaned");
  if (emptiedDeleted) record("temp_voice_deleted");
  return { checked: rows.length, removed, emptiedDeleted };
}

/** Utilisé quand un salon temporaire est supprimé manuellement. */
export function forgetTempVoice(channelId) {
  db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(channelId);
}

export function forgetGuildTempVoices(guildId) {
  db.prepare("DELETE FROM temp_voice WHERE guild_id=?").run(guildId);
}

export async function handleVoiceV2Interaction(interaction, guildSettings = {}) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "voc") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Impossible d’actualiser ton profil serveur. Réessaie.", ephemeral: true });
    return true;
  }
  const channelId = member.voice?.channelId;
  const row = channelId ? tempRow(channelId) : null;
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "demander" || subcommand === "demander-id") {
      const target = subcommand === "demander"
        ? interaction.options.getChannel("salon", true)
        : null;
      const targetId = target?.id ?? interaction.options.getString("id", true).trim();
      if (target && (target.guildId !== guild.id || target.type !== ChannelType.GuildVoice)) {
        throw new Error("Choisis une vocale de ce serveur.");
      }
      if (!/^\d{5,25}$/.test(targetId)) throw new Error("L’ID de la vocale est invalide.");
      await interaction.deferReply({ ephemeral: true });
      const adaptedMessage = {
        guild,
        member,
        author: interaction.user,
        client: interaction.client,
        channel: interaction.channel,
        content: `=demandevocal ${target ? `<#${target.id}>` : targetId}`,
        mentions: { channels: { first: () => null } },
        reply: (payload) => interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
      };
      await handleVoiceAccessRequestMessage(adaptedMessage, guildSettings);
      return true;
    }
    if (subcommand === "debloquer") {
      const targetChannel = interaction.options.getChannel("salon", true);
      const targetMember = interaction.options.getMember("membre") ?? await guild.members.fetch(interaction.options.getUser("membre", true).id).catch(() => null);
      if (targetChannel.guildId !== guild.id || targetChannel.type !== ChannelType.GuildVoice || !targetMember) throw new Error("Choisis une vocale et un membre de ce serveur.");
      const result = removeVoiceAccessBlock({
        guildId: guild.id, channelId: targetChannel.id, userId: targetMember.id, actorId: member.id,
        authorizeActor: ({ actorId }) => actorId === guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageChannels) || member.permissions.has(PermissionFlagsBits.Administrator),
      });
      await interaction.reply({ content: result.removed ? `✅ <@${targetMember.id}> peut à nouveau demander l'accès à **${targetChannel.name}**.` : "Ce membre n'était pas bloqué sur cette vocale.", ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    if (subcommand === "vocal-panel") {
      await interaction.deferReply({ ephemeral: true });
      const adaptedMessage = {
        id: interaction.id,
        guild,
        member,
        author: interaction.user,
        client: interaction.client,
        channel: interaction.channel,
        content: "=panel",
        mentions: { users: { first: () => null }, members: { first: () => null } },
        reply: (payload) => interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
      };
      await handleVoiceMessage(adaptedMessage, guildSettings);
      return true;
    }
    if (subcommand === "panel") {
      if (!row) throw new Error("Tu dois être dans un salon temporaire.");
      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
      if (!channel) throw new Error("Salon temporaire introuvable.");
      const owner = await guild.members.fetch(row.owner_id).catch(() => null);
      await interaction.reply({
        embeds: [themePanelEmbed(new EmbedBuilder()
          .setTitle("🌙 Salon vocal temporaire")
          .addFields(
            { name: "Salon", value: `<#${channel.id}>`, inline: true },
            { name: "Propriétaire", value: owner ? `<@${row.owner_id}>` : `<@${row.owner_id}> (parti)`, inline: true },
            { name: "Limite", value: channel.userLimit ? `${channel.userLimit} membre(s)` : "Illimitée", inline: true },
            { name: "Commandes", value: "`/voc limit` · `/voc name` · `/voc lock` · `/voc unlock` · `/voc claim` · `/voc delete`" },
          ), { thumbnailUrl: guild.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) })],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (!row) throw new Error("Tu dois être dans un salon temporaire.");
    const canManage = canManageTempVoice({
      ownerId: row.owner_id,
      userId: interaction.user.id,
      hasManageChannels: member.permissions.has(P.ManageChannels),
    });
    if (!canManage) throw new Error("Seul le propriétaire du salon (ou le staff) peut faire cela.");
    await interaction.deferReply({ ephemeral: true });
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel) throw new Error("Salon temporaire introuvable.");

    if (subcommand === "limit") {
      const limit = clampVoiceLimit(interaction.options.getInteger("nombre", true));
      await channel.setUserLimit(limit, `Vocal V2 par ${interaction.user.tag}`);
      await interaction.editReply({ content: limit ? `👥 Limite réglée à ${limit} membre(s).` : "👥 Limite retirée.", allowedMentions: { parse: [] } });
    } else if (subcommand === "name") {
      const name = interaction.options.getString("nom", true);
      if (!tempVoiceNameIsValid(name)) throw new Error("Nom invalide.");
      await channel.setName(name, `Vocal V2 par ${interaction.user.tag}`);
      await interaction.editReply({ content: `✏️ Salon renommé en **${name}**.`, allowedMentions: { parse: [] } });
    } else if (subcommand === "claim") {
      const previous = await guild.members.fetch(row.owner_id).catch(() => null);
      if (previous?.voice?.channelId === channel.id) throw new Error("Le propriétaire est encore dans le salon.");
      db.prepare("UPDATE temp_voice SET owner_id=? WHERE channel_id=?").run(interaction.user.id, channel.id);
      await channel.permissionOverwrites.edit(row.owner_id, { ManageChannels: null, MoveMembers: null, MuteMembers: null, DeafenMembers: null }).catch(() => {});
      await channel.permissionOverwrites.edit(interaction.user.id, { ManageChannels: true, MoveMembers: true, MuteMembers: true, DeafenMembers: true }).catch(() => {});
      await interaction.editReply({ content: "👑 Tu es maintenant propriétaire de ce salon.", allowedMentions: { parse: [] } });
    } else if (subcommand === "lock" || subcommand === "unlock") {
      const locked = subcommand === "lock";
      if (locked) await lockPrivateVoiceChannel(channel, member, guild.members.me ?? interaction.client, guildSettings?.sysPlus?.roleId ?? null);
      else await unlockPrivateVoiceChannel(channel);
      await interaction.editReply({ content: locked ? "🔒 Salon verrouillé. Les demandes d'accès sont activées." : "🔓 Salon déverrouillé. Les demandes en attente sont annulées.", allowedMentions: { parse: [] } });
    } else if (subcommand === "delete") {
      db.prepare("DELETE FROM temp_voice WHERE channel_id=?").run(channel.id);
      await channel.delete(`Vocal V2 : suppression par ${interaction.user.tag}`).catch(() => {});
      await interaction.editReply({ content: "🗑️ Salon supprimé.", allowedMentions: { parse: [] } });
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
  return true;
}
