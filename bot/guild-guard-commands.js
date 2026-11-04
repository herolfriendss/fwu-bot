// Her? V4 — configuration de GuildGuard depuis Discord.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { updateModuleSettings } from "./module-settings.js";

function canManage(guild, member) {
  return guild.ownerId === member.id
    || member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function statusEmbed(guild, guard) {
  return new EmbedBuilder()
    .setColor(guard.enabled ? 0x22c55e : 0x6b7280)
    .setTitle("🛡️ GuildGuard")
    .setDescription(guard.enabled ? "La protection est active sur ce serveur." : "La protection est désactivée.")
    .addFields(
      { name: "Âge minimal du compte", value: guard.minAccountAgeDays ? `${guard.minAccountAgeDays} jour(s)` : "Désactivé", inline: true },
      { name: "Action comptes récents", value: guard.youngAccountAction, inline: true },
      { name: "Anti-raid", value: guard.raidJoinThreshold ? `${guard.raidJoinThreshold} connexions / ${guard.raidWindowSeconds}s` : "Désactivé", inline: true },
      { name: "Quarantaine", value: guard.quarantineRoleId ? `<@&${guard.quarantineRoleId}>` : "Non configurée", inline: true },
      { name: "Journal", value: guard.logChannelId ? `<#${guard.logChannelId}>` : "Non configuré", inline: true },
      { name: "Confinement", value: guard.lockdown ? "Activé" : "Désactivé", inline: true },
      { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
    )
    .setFooter({ text: "Chaque serveur possède ses propres réglages et données." });
}

export async function handleGuildGuardInteraction(interaction, guildSettings, { apiUrl, secret, record = () => {} }) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "guildguard") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !canManage(guild, member)) {
    await interaction.reply({ content: "⛔ Réservé au propriétaire du serveur, aux administrateurs ou aux membres ayant Gérer le serveur.", ephemeral: true });
    return true;
  }

  const settings = guildSettings ?? {};
  const guard = settings.guildGuard ?? {};
  const subcommand = interaction.options.getSubcommand();

  const save = async (patch, confirmation) => {
    const next = { ...guard, ...patch, enabled: patch.enabled ?? guard.enabled ?? true };
    const saved = await updateModuleSettings({ apiUrl, secret, guildId: guild.id, module: "guildGuard", value: next, actorId: interaction.user.id });
    settings.guildGuard = saved.guildGuard;
    record("guild_guard_updated");
    await interaction.reply({ content: `✅ ${confirmation}`, ephemeral: true, allowedMentions: { parse: [] } });
  };

  try {
    if (subcommand === "status") {
      await interaction.reply({ embeds: [statusEmbed(guild, guard)], ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    if (subcommand === "enable") {
      await save({ enabled: true }, "GuildGuard est activé.");
      return true;
    }
    if (subcommand === "disable") {
      await save({ enabled: false }, "GuildGuard est désactivé.");
      return true;
    }
    if (subcommand === "account-age") {
      const days = interaction.options.getInteger("jours", true);
      await save({ minAccountAgeDays: days }, days ? `Les comptes de moins de ${days} jour(s) seront contrôlés.` : "Le contrôle d’âge est désactivé.");
      return true;
    }
    if (subcommand === "raid") {
      const connections = interaction.options.getInteger("connexions", true);
      const seconds = interaction.options.getInteger("secondes", true);
      await save({ raidJoinThreshold: connections, raidWindowSeconds: seconds }, connections ? `Anti-raid : plus de ${connections} connexions en ${seconds}s déclenche une alerte.` : "L’anti-raid est désactivé.");
      return true;
    }
    if (subcommand === "quarantine") {
      const role = interaction.options.getRole("role", true);
      if (role.managed || role.id === guild.id) throw new Error("Choisis un rôle normal du serveur.");
      const bot = guild.members.me ?? await guild.members.fetchMe();
      if (role.position >= bot.roles.highest.position) throw new Error("Le rôle doit être placé sous le rôle du bot.");
      await save({ quarantineRoleId: role.id }, `Rôle de quarantaine : ${role.name}.`);
      return true;
    }
    if (subcommand === "log") {
      const channel = interaction.options.getChannel("salon", true);
      if (!channel.isTextBased()) throw new Error("Choisis un salon textuel.");
      await save({ logChannelId: channel.id }, `Journal GuildGuard : #${channel.name}.`);
      return true;
    }
    if (subcommand === "lockdown") {
      const enabled = interaction.options.getString("etat", true) === "on";
      await save({ lockdown: enabled }, enabled ? "Confinement activé : les nouvelles arrivées sont contrôlées." : "Confinement désactivé.");
      return true;
    }
  } catch (error) {
    await interaction.reply({ content: `❌ ${error instanceof Error ? error.message : "Impossible d’enregistrer ce réglage."}`, ephemeral: true }).catch(() => {});
    return true;
  }

  await interaction.reply({ content: "Sous-commande GuildGuard inconnue.", ephemeral: true });
  return true;
}
