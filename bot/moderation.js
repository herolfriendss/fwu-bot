// Her? V4 — modération avancée et vérification.
//
// Les avertissements, le journal et l’éligibilité sont stockés localement dans
// SQLite, toujours par serveur. Les permissions Discord sont revérifiées à chaque
// commande ; aucune sanction ne peut viser un rôle supérieur au bot.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db } from "./database.js";
import {
  activeWarnings, canModerate, formatDuration, parseDuration, sanitizeReason, verificationEligible, warningExpiry,
} from "./moderation-policy.js";

const P = PermissionFlagsBits;
const MODERATION_COMMANDS = new Set(["warn", "warnings", "mute", "unmute", "kick", "ban", "purge", "slowmode", "lock", "unlock", "verify"]);

function logEmbed(guild, interaction, action, target, reason, extra = []) {
  return new EmbedBuilder()
    .setColor(action === "warn" ? 0xf59e0b : 0xef4444)
    .setTitle(`🛡️ Modération — ${action}`)
    .addFields(
      { name: "Membre", value: target ? `${target.tag ?? target.user?.tag ?? target.id} (${target.id})` : "Inconnu", inline: true },
      { name: "Modérateur", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
      { name: "Raison", value: reason, inline: false },
      ...extra,
      { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
    )
    .setTimestamp(new Date());
}

async function sendModerationLog(guild, settings, embed) {
  const channelId = settings?.moderation?.logChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

async function targetMember(guild, user) {
  return guild.members.fetch({ user: user.id, force: true }).catch(() => null);
}

function checkHierarchy(interaction, actor, target, requiredBit) {
  return canModerate({
    actorId: interaction.user.id,
    targetId: target.id,
    guildOwnerId: interaction.guild.ownerId,
    actorPermissions: actor.permissions.bitfield.toString(),
    targetPermissions: target.permissions?.bitfield?.toString() ?? "0",
    actorPosition: actor.roles.highest.position,
    targetPosition: target.roles?.highest?.position ?? -1,
    botPosition: interaction.guild.members.me?.roles.highest.position ?? 0,
    requiredBit: requiredBit.toString(),
  });
}

async function confirm(interaction, content) {
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

export async function handleModerationInteraction(interaction, guildSettings = {}) {
  if (interaction.isButton() && interaction.customId === "verify:claim") {
    await claimVerification(interaction, guildSettings);
    return true;
  }
  if (!interaction.isChatInputCommand() || !MODERATION_COMMANDS.has(interaction.commandName)) return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }

  const actor = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!actor) {
    await interaction.reply({ content: "Je ne trouve pas ton profil sur ce serveur.", ephemeral: true });
    return true;
  }
  const settings = guildSettings ?? {};
  const command = interaction.commandName;

  try {
    if (command === "verify") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "panel") {
        if (!actor.permissions.has(P.ManageGuild)) throw new Error("Permission Gérer le serveur requise.");
        const channel = interaction.options.getChannel("salon") ?? interaction.channel;
        if (!channel?.isTextBased()) throw new Error("Choisis un salon textuel.");
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("✅ Vérification")
          .setDescription(settings.verification?.message || "Clique sur le bouton ci-dessous pour accéder au serveur.");
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
        await channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("verify:claim").setLabel("Se vérifier").setEmoji("✅").setStyle(ButtonStyle.Success),
          )],
          allowedMentions: { parse: [] },
        });
        await interaction.reply({ content: `✅ Panneau de vérification envoyé dans <#${channel.id}>.`, ephemeral: true });
        return true;
      }
      await claimVerification(interaction, settings);
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    if (command === "warnings") {
      const user = interaction.options.getUser("membre") ?? interaction.user;
      if (user.id !== interaction.user.id && !actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise pour consulter un autre membre.");
      const rows = activeWarnings(db.prepare("SELECT * FROM moderation_warnings WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 25").all(guild.id, user.id));
      const lines = rows.map((warning) => `• <t:${Math.floor(Number(warning.created_at) / 1000)}:d> — ${warning.reason} (par <@${warning.moderator_id}>)`);
      await confirm(interaction, lines.length ? `⚠️ **${rows.length} avertissement(s) actif(s) pour <@${user.id}>**\n${lines.join("\n")}` : `✅ Aucun avertissement actif pour <@${user.id}>.`);
      return true;
    }

    if (command === "purge") {
      if (!actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise.");
      if (!interaction.channel?.isTextBased() || typeof interaction.channel.bulkDelete !== "function") throw new Error("Cette commande doit être utilisée dans un salon textuel.");
      const amount = interaction.options.getInteger("nombre", true);
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await confirm(interaction, `🧹 ${deleted.size} message(s) supprimé(s).`);
      return true;
    }

    if (command === "slowmode") {
      if (!actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise.");
      if (!interaction.channel || !("setRateLimitPerUser" in interaction.channel)) throw new Error("Salon incompatible.");
      const seconds = interaction.options.getInteger("secondes", true);
      await interaction.channel.setRateLimitPerUser(seconds, `Modération par ${interaction.user.tag}`);
      await confirm(interaction, seconds ? `🐢 Mode lent réglé sur ${seconds} seconde(s).` : "🐇 Mode lent désactivé.");
      return true;
    }

    if (command === "lock" || command === "unlock") {
      if (!actor.permissions.has(P.ManageChannels)) throw new Error("Permission Gérer les salons requise.");
      if (!interaction.channel?.permissionOverwrites) throw new Error("Salon incompatible.");
      const locked = command === "lock";
      await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: `Modération par ${interaction.user.tag}` });
      await confirm(interaction, locked ? "🔒 Salon verrouillé." : "🔓 Salon déverrouillé.");
      return true;
    }

    const user = interaction.options.getUser("membre", true);
    const target = await targetMember(guild, user);
    const reason = sanitizeReason(interaction.options.getString("raison") ?? "");

    const required = command === "kick" ? P.KickMembers : command === "ban" ? P.BanMembers : command === "mute" || command === "unmute" ? P.ModerateMembers : P.ManageMessages;
    const hierarchy = checkHierarchy(interaction, actor, target ?? { id: user.id, permissions: { bitfield: 0n }, roles: null }, required);
    if (!hierarchy.allowed) throw new Error(hierarchy.reason ?? "Action refusée.");

    if (command === "warn") {
      const days = interaction.options.getInteger("expire") ?? 0;
      const expiresAt = warningExpiry(Date.now(), days) ?? null;
      db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,?)")
        .run(guild.id, user.id, interaction.user.id, reason, Date.now(), expiresAt);
      const count = db.prepare("SELECT COUNT(*) AS count FROM moderation_warnings WHERE guild_id=? AND user_id=? AND (expires_at IS NULL OR expires_at>?)").get(guild.id, user.id, Date.now()).count;
      if (settings.moderation?.dmOnWarn !== false) {
        await user.send({ content: `⚠️ Tu as reçu un avertissement sur **${guild.name}** : ${reason}`, allowedMentions: { parse: [] } }).catch(() => {});
      }
      await sendModerationLog(guild, settings, logEmbed(guild, interaction, "warn", user, reason, [{ name: "Avertissements actifs", value: String(count), inline: true }]));
      await confirm(interaction, `⚠️ <@${user.id}> averti (${count} actif(s)) : ${reason}`);
      return true;
    }

    if (command === "mute") {
      if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
      const minutes = parseDuration(interaction.options.getString("duree", true), 10);
      if (minutes > 40_320) throw new Error("La sourdine Discord est limitée à 28 jours.");
      await target.timeout(minutes * 60_000, reason);
      await sendModerationLog(guild, settings, logEmbed(guild, interaction, "mute", user, reason, [{ name: "Durée", value: formatDuration(minutes), inline: true }]));
      await confirm(interaction, `🔇 <@${user.id}> mis en sourdine pendant ${formatDuration(minutes)}.`);
      return true;
    }

    if (command === "unmute") {
      if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
      await target.timeout(null, reason);
      await sendModerationLog(guild, settings, logEmbed(guild, interaction, "unmute", user, reason));
      await confirm(interaction, `🔊 Sourdine retirée à <@${user.id}>.`);
      return true;
    }

    if (command === "kick") {
      if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
      await target.kick(reason);
      await sendModerationLog(guild, settings, logEmbed(guild, interaction, "kick", user, reason));
      await confirm(interaction, `👢 <@${user.id}> expulsé.`);
      return true;
    }

    if (command === "ban") {
      await guild.members.ban(user.id, { reason, deleteMessageSeconds: 0 });
      await sendModerationLog(guild, settings, logEmbed(guild, interaction, "ban", user, reason));
      await confirm(interaction, `🔨 <@${user.id}> banni.`);
      return true;
    }
  } catch (error) {
    const message = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    return true;
  }

  return true;
}

async function claimVerification(interaction, settings) {
  const verification = settings?.verification;
  if (!verification?.enabled || !verification.roleId) {
    await interaction.reply({ content: "La vérification n’est pas configurée sur ce serveur.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const role = await guild.roles.fetch(verification.roleId).catch(() => null);
  if (!role) {
    await interaction.reply({ content: "Le rôle de vérification est introuvable. Préviens le staff.", ephemeral: true });
    return;
  }
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(role.id)) {
    await interaction.reply({ content: "✅ Tu es déjà vérifié.", ephemeral: true });
    return;
  }
  const eligibility = verificationEligible(interaction.user.createdAt, Date.now(), verification.minAccountAgeDays);
  if (!eligibility.eligible) {
    await interaction.reply({ content: `⛔ Vérification refusée : ${eligibility.reason}.`, ephemeral: true });
    return;
  }
  try {
    await member.roles.add(role, "Vérification Discord");
    await interaction.reply({ content: "✅ Vérification réussie, bienvenue !", ephemeral: true });
  } catch {
    await interaction.reply({ content: "Impossible d’attribuer le rôle. Vérifie la hiérarchie des rôles.", ephemeral: true });
  }
}
