// Her? V4 — modération avancée et vérification.
//
// Les avertissements, le journal et l’éligibilité sont stockés localement dans
// SQLite, toujours par serveur. Les permissions Discord sont revérifiées à chaque
// commande ; aucune sanction ne peut viser un rôle supérieur au bot.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db } from "./database.js";
import {
  activeWarnings, formatDuration, parseDuration, parseMemberReference, sanitizeReason, verificationEligible, warningExpiry,
} from "./moderation-policy.js";
import {
  botCanModerate, canUseModeration, getRemovableConfiguredRoleIds, isProtectedMember, isStrictlyAbove, nextProtectStrike, protectStrikeAction,
} from "./moderation-protection-policy.js";

const P = PermissionFlagsBits;
const MODERATION_COMMANDS = new Set(["warn", "warnings", "mute", "unmute", "kick", "ban", "purge", "slowmode", "lock", "unlock", "verify", "protect"]);
const SANCTION_COMMANDS = new Set(["warn", "mute", "unmute", "kick", "ban"]);

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

async function confirm(interaction, content) {
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

export async function handleModerationInteraction(interaction, guildSettings = {}, { apiUrl, secret } = {}) {
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

  // Always resolve a full GuildMember: interaction.member may be the raw API shape.
  const actor = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
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

    if (command === "protect") {
      if (actor.id !== guild.ownerId && !actor.permissions.has(P.Administrator)) {
        throw new Error("Seul le propriétaire du serveur ou un administrateur peut configurer Protect.");
      }
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "role") {
        const role = interaction.options.getRole("role", true);
        if (role.managed || role.id === guild.id) throw new Error("Choisis un rôle normal du serveur.");
        const nextModeration = { ...(settings.moderation ?? {}), protectRoleId: role.id };
        if (!apiUrl || !secret) throw new Error("La synchronisation du dashboard n’est pas configurée sur le bot (API/secret manquant).");
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ action: "module-settings", module: "moderation", guildId: guild.id, settings: nextModeration }),
        });
        if (!response.ok) throw new Error(`Impossible d’enregistrer Protect (HTTP ${response.status}).`);
        const saved = await response.json();
        Object.assign(settings.moderation ?? (settings.moderation = {}), saved.settings?.moderation ?? nextModeration);
        await confirm(interaction, `🛡️ Le rôle Protect est maintenant ${role}. Ses membres ne pourront être sanctionnés par aucune commande de modération.`);
        return true;
      }
      if (subcommand === "reset") {
        if (!apiUrl || !secret) throw new Error("La synchronisation du dashboard n’est pas configurée sur le bot (API/secret manquant).");
        const nextModeration = { ...(settings.moderation ?? {}), protectRoleId: null };
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ action: "module-settings", module: "moderation", guildId: guild.id, settings: nextModeration }),
        });
        if (!response.ok) throw new Error(`Impossible d’enregistrer Protect (HTTP ${response.status}).`);
        const saved = await response.json();
        Object.assign(settings.moderation ?? (settings.moderation = {}), saved.settings?.moderation ?? nextModeration);
        await confirm(interaction, "Le rôle Protect a été désactivé.");
        return true;
      }
      if (subcommand === "strikes") {
        const member = interaction.options.getUser("membre") ?? interaction.user;
        const row = db.prepare("SELECT strikes, updated_at FROM moderation_protect_strikes WHERE guild_id=? AND moderator_id=?")
          .get(guild.id, member.id);
        const count = Number(row?.strikes ?? 0);
        const updated = row?.updated_at
          ? `\nDernière tentative : <t:${Math.floor(Number(row.updated_at) / 1000)}:R>.`
          : "";
        await confirm(interaction, `🛡️ Protect — <@${member.id}> : **${count}/3** tentative(s) enregistrée(s).${updated}`);
        return true;
      }
      if (subcommand === "reset-strikes") {
        const member = interaction.options.getUser("membre") ?? interaction.user;
        const result = db.prepare("DELETE FROM moderation_protect_strikes WHERE guild_id=? AND moderator_id=?")
          .run(guild.id, member.id);
        await sendModerationLog(guild, settings, logEmbed(
          guild, interaction, "protect-reset", member,
          `Compteur Protect réinitialisé par <@${interaction.user.id}>.`,
        ));
        await confirm(interaction, result.changes
          ? `✅ Compteur Protect de <@${member.id}> réinitialisé.`
          : `ℹ️ Aucun compteur Protect actif pour <@${member.id}>.`);
        return true;
      }
      await confirm(interaction, settings.moderation?.protectRoleId
        ? `Rôle Protect actuel : <@&${settings.moderation.protectRoleId}>.`
        : "Aucun rôle Protect n’est configuré.");
      return true;
    }

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
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botMember.permissionsIn(interaction.channel).has(P.ManageMessages)) {
        throw new Error("Le bot doit avoir la permission Gérer les messages dans ce salon.");
      }
      const amount = interaction.options.getInteger("nombre", true);
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await confirm(interaction, `🧹 ${deleted.size} message(s) supprimé(s).`);
      return true;
    }

    if (command === "slowmode") {
      if (!actor.permissions.has(P.ManageChannels)) throw new Error("Permission Gérer les salons requise.");
      if (!interaction.channel || !("setRateLimitPerUser" in interaction.channel)) throw new Error("Salon incompatible.");
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botMember.permissionsIn(interaction.channel).has(P.ManageChannels)) {
        throw new Error("Le bot doit avoir la permission Gérer les salons dans ce salon.");
      }
      const seconds = interaction.options.getInteger("secondes", true);
      await interaction.channel.setRateLimitPerUser(seconds, `Modération par ${interaction.user.tag}`);
      await confirm(interaction, seconds ? `🐢 Mode lent réglé sur ${seconds} seconde(s).` : "🐇 Mode lent désactivé.");
      return true;
    }

    if (command === "lock" || command === "unlock") {
      if (!actor.permissions.has(P.ManageChannels)) throw new Error("Permission Gérer les salons requise.");
      if (!interaction.channel?.permissionOverwrites) throw new Error("Salon incompatible.");
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botMember.permissionsIn(interaction.channel).has(P.ManageChannels)) {
        throw new Error("Le bot doit avoir la permission Gérer les salons dans ce salon.");
      }
      const locked = command === "lock";
      await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: `Modération par ${interaction.user.tag}` });
      await confirm(interaction, locked ? "🔒 Salon verrouillé." : "🔓 Salon déverrouillé.");
      return true;
    }

    const user = interaction.options.getUser("membre", true);
    const target = await targetMember(guild, user);
    const reason = sanitizeReason(interaction.options.getString("raison") ?? "");

    if (SANCTION_COMMANDS.has(command)) {
      const moderationSettings = settings.moderation ?? {};
      if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
      if (actor.id === target.id) throw new Error("Tu ne peux pas te sanctionner toi-même.");
      if (!canUseModeration(actor, guild.ownerId, settings.sysPlus?.roleId, moderationSettings.staffRoleIds ?? [])) {
        throw new Error("Tu ne possèdes aucun rôle autorisé à utiliser les sanctions. Les rôles sont configurables dans le dashboard.");
      }

      // Protect s'applique à tous les rôles sélectionnés, quel que soit le type de sanction.
      if (isProtectedMember(target, guild.ownerId, moderationSettings.protectRoleId, moderationSettings.untouchableRoleIds ?? [])) {
        if (actor.id === guild.ownerId) {
          await sendModerationLog(guild, settings, logEmbed(guild, interaction, "protect-block", user, `Tentative /${command} bloquée — cible protégée — propriétaire`));
          throw new Error("⛔ Sanction bloquée : ce membre est protégé par Protect.");
        }

        const row = db.prepare("SELECT strikes FROM moderation_protect_strikes WHERE guild_id=? AND moderator_id=?").get(guild.id, actor.id);
        const strike = nextProtectStrike(row?.strikes ?? 0);
        db.prepare(`INSERT INTO moderation_protect_strikes(guild_id,moderator_id,strikes,updated_at)
          VALUES(?,?,?,?) ON CONFLICT(guild_id,moderator_id) DO UPDATE SET strikes=excluded.strikes,updated_at=excluded.updated_at`)
          .run(guild.id, actor.id, strike, Date.now());

        const action = protectStrikeAction(strike);
        let consequence = "Avertissement enregistré.";
        const botMember = guild.members.me ?? await guild.members.fetchMe();

        if (action === "warn") {
          await actor.send(`⚠️ Avertissement Protect 1/3 sur **${guild.name}** : tu as tenté d’utiliser /${command} sur un membre protégé. Toute nouvelle tentative entraînera une sanction.`).catch(() => {});
        } else if (action === "timeout") {
          if (!botMember.permissions.has(P.ModerateMembers) || !botCanModerate(botMember, actor)) {
            consequence = "2e tentative : le timeout de 5 minutes n’a pas pu être appliqué (permissions ou hiérarchie du bot insuffisantes).";
          } else {
            try {
              await actor.timeout(5 * 60_000, "Protect : deuxième tentative de sanction d’un membre protégé.");
              consequence = "Timeout automatique de 5 minutes appliqué.";
            } catch {
              consequence = "2e tentative : Discord a refusé le timeout ; la cible protégée reste intacte.";
            }
          }
        } else {
          const configuredRoleIds = [...new Set([...(moderationSettings.staffRoleIds ?? []), settings.sysPlus?.roleId].filter(Boolean))];
          const removable = botMember.permissions.has(P.ManageRoles)
            ? getRemovableConfiguredRoleIds(actor, botMember, configuredRoleIds)
            : [];
          if (!removable.length) {
            consequence = "3e tentative : aucun rôle staff configuré ne peut être retiré par le bot (rôle absent, géré ou hiérarchie/permission insuffisante).";
          } else {
            try {
              await actor.roles.remove(removable, "Protect : troisième tentative de sanction d’un membre protégé.");
              consequence = `3e tentative : ${removable.length} rôle(s) staff configuré(s) retiré(s).`;
            } catch {
              consequence = "3e tentative : Discord a refusé le retrait des rôles ; la cible protégée reste intacte.";
            }
          }
          await actor.send(`⛔ Protect 3/3 sur **${guild.name}** : tentative de retrait des rôles staff configurés. Contacte un owner.`).catch(() => {});
        }

        await sendModerationLog(guild, settings, logEmbed(guild, interaction, "protect-block", user, `Tentative /${command} bloquée — Protect ${strike}/3 — ${consequence}`));
        throw new Error(`⛔ Sanction bloquée : ce membre est protégé. Tentative ${strike}/3. ${consequence}`);
      }

      // Une hiérarchie explicite remplace les permissions implicites Discord :
      // les rôles autorisés dans le dashboard peuvent aussi sanctionner un staff/Admin
      // placé en dessous d'eux, sauf si ce membre est configuré comme intouchable.
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botCanModerate(botMember, target)) {
        throw new Error("Le rôle du bot doit être strictement supérieur à celui du membre ciblé.");
      }
      if (actor.id !== guild.ownerId && !isStrictlyAbove(actor, target)) {
        throw new Error("Ton rôle le plus élevé doit être strictement supérieur à celui du membre ciblé.");
      }

      // Les rôles configurés autorisent l'usage de la commande, mais ne donnent
      // jamais au bot des permissions Discord qu'il ne possède pas réellement.
      const botPermission = command === "kick"
        ? P.KickMembers
        : command === "ban"
          ? P.BanMembers
          : command === "mute" || command === "unmute"
            ? P.ModerateMembers
            : null;
      if (botPermission && !botMember.permissions.has(botPermission)) {
        throw new Error("Le bot ne possède pas la permission Discord nécessaire pour cette sanction.");
      }
    }

    if (command === "warn") {
      const days = interaction.options.getInteger("expire")
        ?? Number(settings.moderation?.warnExpiryDays ?? 0);
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
      const minutes = parseDuration(interaction.options.getString("duree", true));
      if (minutes === null) throw new Error("Durée invalide. Utilise 10m, 2h ou 1d (maximum 28 jours).");
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
  // Buttons can arrive with a raw APIInteractionGuildMember; fetch the full member.
  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Impossible de retrouver ton profil sur le serveur.", ephemeral: true });
    return;
  }
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


const PREFIX_MODERATION_COMMANDS = new Set([
  "=warn", "=warnings", "=mute", "=unmute", "=kick", "=ban",
  "=purge", "=clear", "=slowmode", "=lock", "=unlock",
]);

function prefixTargetId(_message, rawValue) {
  const raw = String(rawValue ?? "").trim();
  const match = raw.match(/^(?:<@!?(\d{5,25})>|(\d{5,25}))$/);
  return match?.[1] ?? match?.[2] ?? null;
}/**
 * Prefix moderation shares the same authorization, hierarchy and Protect
 * policies as slash moderation. Returns false only for unrelated messages.
 */
export async function handleModerationMessage(message, guildSettings = {}) {
  if (!message?.guild) return false;
  const parts = String(message.content ?? "").trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  if (!PREFIX_MODERATION_COMMANDS.has(command)) return false;

  const guild = message.guild;
  const settings = guildSettings ?? {};
  const moderationSettings = settings.moderation ?? {};
  const say = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  const actor = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!actor) {
    await say("❌ Je ne trouve pas ton profil sur le serveur.");
    return true;
  }

  try {
    if (command === "=purge" || command === "=clear") {
      if (!actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise.");
      const amount = Number(parts[1]);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        throw new Error("Utilisation : =clear 1-100");
      }
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botMember.permissionsIn(message.channel).has(P.ManageMessages)) {
        throw new Error("Le bot doit avoir la permission Gérer les messages dans ce salon.");
      }
      const deleted = await message.channel.bulkDelete(amount, true);
      await message.channel.send({ content: `🧹 ${deleted.size} message(s) supprimé(s).`, allowedMentions: { parse: [] } });
      return true;
    }

    if (command === "=slowmode") {
      if (!actor.permissions.has(P.ManageChannels)) throw new Error("Permission Gérer les salons requise.");
      if (!message.channel || typeof message.channel.setRateLimitPerUser !== "function") throw new Error("Salon incompatible.");
      const seconds = Number(parts[1]);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21_600) {
        throw new Error("Utilisation : =slowmode 0-21600");
      }
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botMember.permissionsIn(message.channel).has(P.ManageChannels)) {
        throw new Error("Le bot doit avoir la permission Gérer les salons dans ce salon.");
      }
      await message.channel.setRateLimitPerUser(seconds, `Modération par ${message.author.tag}`);
      await say(seconds ? `🐢 Mode lent réglé sur ${seconds} seconde(s).` : "🐇 Mode lent désactivé.");
      return true;
    }

    if (command === "=lock" || command === "=unlock") {
      if (!actor.permissions.has(P.ManageChannels)) throw new Error("Permission Gérer les salons requise.");
      if (!message.channel?.permissionOverwrites) throw new Error("Salon incompatible.");
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      if (!botMember.permissionsIn(message.channel).has(P.ManageChannels)) {
        throw new Error("Le bot doit avoir la permission Gérer les salons dans ce salon.");
      }
      const locked = command === "=lock";
      await message.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: locked ? false : null },
        { reason: `Modération par ${message.author.tag}` },
      );
      await say(locked ? "🔒 Salon verrouillé." : "🔓 Salon déverrouillé.");
      return true;
    }

    if (command === "=warnings") {
      const targetId = prefixTargetId(message, parts[1]) ?? actor.id;
      if (targetId !== actor.id && !actor.permissions.has(P.ManageMessages)) {
        throw new Error("Permission Gérer les messages requise pour consulter un autre membre.");
      }
      const rows = activeWarnings(
        db.prepare("SELECT * FROM moderation_warnings WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 25")
          .all(guild.id, targetId),
      );
      const lines = rows.map((warning) =>
        `• <t:${Math.floor(Number(warning.created_at) / 1000)}:d> — ${warning.reason} (par <@${warning.moderator_id}>)`,
      );
      await say(lines.length
        ? `⚠️ **${rows.length} avertissement(s) actif(s) pour <@${targetId}>**\n${lines.join("\n")}`
        : `✅ Aucun avertissement actif pour <@${targetId}>.`);
      return true;
    }

    const targetId = prefixTargetId(message, parts[1]);
    if (!targetId) throw new Error(`Utilisation : ${command} @membre [raison]`);
    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
    const user = target.user;
    if (actor.id === target.id) throw new Error("Tu ne peux pas te sanctionner toi-même.");
    if (!canUseModeration(actor, guild.ownerId, settings.sysPlus?.roleId, moderationSettings.staffRoleIds ?? [])) {
      throw new Error("Tu ne possèdes aucun rôle autorisé à utiliser les sanctions.");
    }



    // Protect is deliberately checked before hierarchy: even a lower-ranked
    // authorized moderator receives a strike for attempting to sanction a protected member.
    if (isProtectedMember(target, guild.ownerId, moderationSettings.protectRoleId, moderationSettings.untouchableRoleIds ?? [])) {
      if (actor.id === guild.ownerId) {
        await sendModerationLog(guild, settings, logEmbed(
          guild, { user: message.author }, "protect-block", user, `Tentative ${command} bloquée — cible protégée — propriétaire`,
        ));
        throw new Error("⛔ Sanction bloquée : ce membre est protégé par Protect.");
      }

      const row = db.prepare("SELECT strikes FROM moderation_protect_strikes WHERE guild_id=? AND moderator_id=?")
        .get(guild.id, actor.id);
      const strike = nextProtectStrike(row?.strikes ?? 0);
      db.prepare(`INSERT INTO moderation_protect_strikes(guild_id,moderator_id,strikes,updated_at)
        VALUES(?,?,?,?) ON CONFLICT(guild_id,moderator_id) DO UPDATE SET strikes=excluded.strikes,updated_at=excluded.updated_at`)
        .run(guild.id, actor.id, strike, Date.now());

      const action = protectStrikeAction(strike);
      const botMember = guild.members.me ?? await guild.members.fetchMe();
      let consequence = "Avertissement Protect enregistré.";
      if (action === "warn") {
        await actor.send(`⚠️ Avertissement Protect 1/3 sur **${guild.name}** : tu as tenté d’utiliser ${command} sur un membre protégé.`).catch(() => {});
        consequence = "Avertissement privé envoyé (si les MP sont ouverts).";
      } else if (action === "timeout") {
        if (botMember.permissions.has(P.ModerateMembers) && botCanModerate(botMember, actor)) {
          try {
            await actor.timeout(5 * 60_000, "Protect : deuxième tentative de sanction d’un membre protégé.");
            consequence = "Timeout automatique de 5 minutes appliqué.";
          } catch {
            consequence = "Timeout de 5 minutes impossible à appliquer (Discord a refusé).";
          }
        } else {
          consequence = "Timeout de 5 minutes impossible : permissions ou hiérarchie du bot insuffisantes.";
        }
      } else {
        const configuredRoleIds = [...new Set([
          ...(moderationSettings.staffRoleIds ?? []), settings.sysPlus?.roleId,
        ].filter(Boolean))];
        const removable = botMember.permissions.has(P.ManageRoles)
          ? getRemovableConfiguredRoleIds(actor, botMember, configuredRoleIds)
          : [];
        if (removable.length) {
          try {
            await actor.roles.remove(removable, "Protect : troisième tentative de sanction d’un membre protégé.");
            consequence = `${removable.length} rôle(s) staff configuré(s) retiré(s).`;
          } catch {
            consequence = "Retrait des rôles staff refusé par Discord.";
          }
        } else {
          consequence = "Aucun rôle staff configuré ne peut être retiré en toute sécurité.";
        }
        await actor.send(`⛔ Protect 3/3 sur **${guild.name}** : retrait des rôles staff configurés tenté. Contacte un owner.`).catch(() => {});
      }

      await sendModerationLog(guild, settings, logEmbed(
        guild, { user: message.author }, "protect-block", user,
        `Tentative ${command} bloquée — Protect ${strike}/3 — ${consequence}`,
      ));
      await say(`⛔ Sanction bloquée : membre protégé. Tentative ${strike}/3. ${consequence}`);
      return true;
    }

    const botMember = guild.members.me ?? await guild.members.fetchMe();
    if (!botCanModerate(botMember, target)) {
      throw new Error("Le rôle du bot doit être strictement supérieur à celui du membre ciblé.");
    }
    if (actor.id !== guild.ownerId && !isStrictlyAbove(actor, target)) {
      throw new Error("Ton rôle le plus élevé doit être strictement supérieur à celui du membre ciblé.");
    }

    const requiredPermission = command === "=kick"
      ? P.KickMembers
      : command === "=ban"
        ? P.BanMembers
        : command === "=mute" || command === "=unmute"
          ? P.ModerateMembers
          : null;
    if (requiredPermission && !botMember.permissions.has(requiredPermission)) {
      throw new Error("Le bot ne possède pas la permission Discord nécessaire pour cette sanction.");
    }

    if (command === "=warn") {
      const reason = sanitizeReason(parts.slice(2).join(" "));
      const expiresAt = warningExpiry(Date.now(), Number(moderationSettings.warnExpiryDays ?? 0));
      db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,?)")
        .run(guild.id, user.id, message.author.id, reason, Date.now(), expiresAt);
      const count = db.prepare("SELECT COUNT(*) AS count FROM moderation_warnings WHERE guild_id=? AND user_id=? AND (expires_at IS NULL OR expires_at>?)")
        .get(guild.id, user.id, Date.now()).count;
      if (moderationSettings.dmOnWarn !== false) {
        await user.send({ content: `⚠️ Tu as reçu un avertissement sur **${guild.name}** : ${reason}`, allowedMentions: { parse: [] } }).catch(() => {});
      }
      await sendModerationLog(guild, settings, logEmbed(
        guild, { user: message.author }, "warn", user, reason,
        [{ name: "Avertissements actifs", value: String(count), inline: true }],
      ));
      await say(`⚠️ <@${user.id}> averti (${count} actif(s)) : ${reason}`);
      return true;
    }

    if (command === "=mute") {
      const minutes = parseDuration(parts[2]);
      if (minutes === null) {
        throw new Error("Utilisation : =mute @membre 10m [raison] (maximum 28 jours).");
      }
      const muteReason = sanitizeReason(parts.slice(3).join(" "));
      await target.timeout(minutes * 60_000, muteReason);
      await sendModerationLog(guild, settings, logEmbed(
        guild, { user: message.author }, "mute", user, muteReason,
        [{ name: "Durée", value: formatDuration(minutes), inline: true }],
      ));
      await say(`🔇 <@${user.id}> mis en sourdine pendant ${formatDuration(minutes)}.`);
      return true;
    }

    if (command === "=unmute") {
      const muteReason = sanitizeReason(parts.slice(2).join(" "));
      await target.timeout(null, muteReason);
      await sendModerationLog(guild, settings, logEmbed(guild, { user: message.author }, "unmute", user, muteReason));
      await say(`🔊 Sourdine retirée à <@${user.id}>.`);
      return true;
    }

    if (command === "=kick") {
      const kickReason = sanitizeReason(parts.slice(2).join(" "));
      await target.kick(kickReason);
      await sendModerationLog(guild, settings, logEmbed(guild, { user: message.author }, "kick", user, kickReason));
      await say(`👢 <@${user.id}> expulsé.`);
      return true;
    }

    if (command === "=ban") {
      const banReason = sanitizeReason(parts.slice(2).join(" "));
      await guild.members.ban(user.id, { reason: banReason, deleteMessageSeconds: 0 });
      await sendModerationLog(guild, settings, logEmbed(guild, { user: message.author }, "ban", user, banReason));
      await say(`🔨 <@${user.id}> banni.`);
      return true;
    }

    return true;
  } catch (error) {
    await say(`❌ ${error instanceof Error ? error.message : "Action impossible."}`).catch(() => {});
    return true;
  }
}
