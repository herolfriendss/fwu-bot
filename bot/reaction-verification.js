import { PermissionFlagsBits } from "discord.js";
import { buildRaidCaptchaNotice, buildVerificationPanel, buildWelcomeEmbed, recordVerification, verificationStatus } from "./verification-panel.js";
import { isRaidActive } from "./guard/raid-protection.js";
import { assertRoleGrantable } from "./role-grant-guard.js";
import { db } from "./database.js";

const P = PermissionFlagsBits;
const CHECK = "✅";

db.exec(`
  CREATE TABLE IF NOT EXISTS reaction_verification_panels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

export async function handleReactionVerificationCommand(message) {
  const content = String(message.content ?? "").trim();

  if (!/^=verification(?:\s|$)/i.test(content)) return false;
  if (!message.guild || !message.member) return true;

  try {
    if (!message.member.permissions.has(P.ManageGuild)) {
      throw new Error("La permission Gérer le serveur est nécessaire.");
    }

    // État de vérification d'un membre (staff : Gérer le serveur, vérifié plus haut).
    const statusMatch = content.match(/^=verification\s+etat\s+<@!?(\d{17,20})>/i);
    if (statusMatch) {
      const row = db.prepare("SELECT role_id FROM reaction_verification_panels WHERE guild_id=?").get(message.guild.id);
      const target = await message.guild.members.fetch(statusMatch[1]).catch(() => null);
      const { text } = verificationStatus(message.guild.id, statusMatch[1], { hasRole: row && target ? target.roles.cache.has(row.role_id) : null });
      await message.reply({ content: `**Vérification de <@${statusMatch[1]}>**\n${text}`, allowedMentions: { parse: [] } });
      return true;
    }
    if (/^=verification\s+off$/i.test(content)) {
      db.prepare("DELETE FROM reaction_verification_panels WHERE guild_id=?")
        .run(message.guild.id);
      await message.reply({
        content: "✅ Le système de vérification par réaction est désactivé. L'ancien message ne donne désormais plus aucun rôle.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const channel = message.mentions.channels.first();
    const role = message.mentions.roles.first();

    if (!channel || !role || channel.guildId !== message.guild.id ||
        typeof channel.send !== "function" || !channel.isTextBased()) {
      throw new Error("Utilisation : `=verification #accès @Vérifié` ou `=verification off`.");
    }

    if (role.id === message.guild.id || role.managed ||
        role.permissions.has(P.Administrator)) {
      throw new Error("Ce rôle est protégé ou possède les permissions Administrateur. Choisis un rôle membre standard.");
    }
    await assertRoleGrantable(message.guild, role, { automatic: true });

    const botMember = await message.guild.members.fetchMe();

    if (!botMember.permissions.has(P.ManageRoles)) {
      throw new Error("Je dois posséder la permission Gérer les rôles.");
    }

    if (role.position >= botMember.roles.highest.position) {
      throw new Error("Place mon rôle au-dessus du rôle Vérifié dans la hiérarchie Discord.");
    }

    const botChannelPermissions = channel.permissionsFor(botMember);
    const required = [
      P.ViewChannel, P.SendMessages, P.EmbedLinks,
      P.AddReactions, P.ReadMessageHistory,
    ];

    if (!botChannelPermissions ||
        required.some((permission) => !botChannelPermissions.has(permission))) {
      throw new Error("Il me manque des permissions dans le salon : voir, envoyer des messages, intégrer des liens, ajouter des réactions ou lire l'historique.");
    }

    const publicPermissions = channel.permissionsFor(message.guild.roles.everyone);
    if (!publicPermissions?.has(P.ViewChannel) ||
        !publicPermissions.has(P.ReadMessageHistory)) {
      throw new Error("Le salon doit être visible et lisible par @everyone avant vérification.");
    }

    // V2 : panneau refait (bannière, étapes visibles, nom du serveur, CAPTCHA en mode raid).
    const embed = buildVerificationPanel({ guildName: message.guild.name, raid: isRaidActive(message.guild.id) });

    const sent = await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    try {
      await sent.react(CHECK);
    } catch (error) {
      await sent.delete().catch(() => {});
      throw new Error("Impossible d'ajouter la réaction ✅. Vérifie ma permission Ajouter des réactions.");
    }

    db.prepare(`
      INSERT INTO reaction_verification_panels
        (guild_id, channel_id, message_id, role_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id=excluded.channel_id,
        message_id=excluded.message_id,
        role_id=excluded.role_id,
        created_by=excluded.created_by,
        created_at=excluded.created_at
    `).run(
      message.guild.id, channel.id, sent.id,
      role.id, message.author.id, Date.now()
    );

    await message.reply({
      content: `✅ Règlement publié dans <#${channel.id}>. La réaction donne désormais le rôle <@&${role.id}>.`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await message.reply({
      content: `❌ ${error instanceof Error ? error.message : "Configuration impossible."}`,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  return true;
}

export async function handleReactionVerificationReaction(reaction, user) {
  if (!user || user.bot) return false;

  let current = reaction;
  if (current.partial) current = await current.fetch();

  let message = current.message;
  if (message.partial) message = await message.fetch();

  if (current.emoji.name !== CHECK) return false;

  const guildId = message.guildId ?? message.guild?.id;
  if (!guildId) return false;

  const config = db.prepare(`
    SELECT channel_id, message_id, role_id
    FROM reaction_verification_panels WHERE guild_id=?
  `).get(guildId);

  if (!config ||
      config.message_id !== message.id ||
      config.channel_id !== message.channelId) {
    return false;
  }

  const guild = message.guild ?? await message.client.guilds.fetch(guildId);
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return true;

  const role = await guild.roles.fetch(config.role_id).catch(() => null);
  if (!role || role.managed || role.id === guild.id) {
    throw new Error("Le rôle de vérification configuré est introuvable ou protégé.");
  }

  if (member.roles.cache.has(role.id)) return true;
  // Tout le monde peut réagir : le rôle ne doit jamais donner d'accès, de palier ou de permission.
  await assertRoleGrantable(guild, role, { automatic: true });

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(P.ManageRoles) ||
      role.position >= botMember.roles.highest.position) {
    throw new Error("Permission Gérer les rôles ou hiérarchie insuffisante.");
  }

  // Mode raid : l'acceptation ne suffit plus, le CAPTCHA devient obligatoire.
  if (isRaidActive(guild.id)) {
    recordVerification(guild.id, member.id, "pending_captcha", "réaction");
    await member.send?.({ embeds: [buildRaidCaptchaNotice(guild.name, config.channel_id)], allowedMentions: { parse: [] } })?.catch?.(() => {});
    return true;
  }
  await member.roles.add(role, "Acceptation du règlement par réaction ✅");
  recordVerification(guild.id, member.id, "verified", "réaction");
  await member.send?.({ embeds: [buildWelcomeEmbed(guild.name, member.id)], allowedMentions: { parse: [] } })?.catch?.(() => {});
  return true;
}
