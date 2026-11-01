import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { canConfigureSysPlus, isSysPlus } from "./permissions.js";

const AUTH = (secret) => ({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });

export async function handleSysPlusMessage(message, settings, { apiUrl, secret, record }) {
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  if (command !== "=sysp") return false;

  const roleId = settings?.sysPlus?.roleId ?? null;
  const args = parts.slice(1);

  // Configuration is deliberately restricted to the server owner / Discord admins.
  if (args[0]?.toLowerCase() === "role") {
    if (!canConfigureSysPlus(message.member)) {
      await message.reply("⛔ Seul le propriétaire du serveur ou un administrateur Discord peut configurer le rôle Perm Sys+.");
      return true;
    }
    const roleMention = message.mentions.roles.first();
    const rawId = args[1]?.replace(/[<@&>]/g, "");
    const targetId = roleMention?.id ?? (rawId && /^\d{5,25}$/.test(rawId) ? rawId : null);
    if (!targetId) {
      await message.reply("Utilisation : `=sysp role @Rôle`");
      return true;
    }
    const role = await message.guild.roles.fetch(targetId).catch(() => null);
    if (!role || role.managed || role.id === message.guild.id) {
      await message.reply("❌ Rôle invalide. Mentionne un rôle normal du serveur.");
      return true;
    }
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: AUTH(secret),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ action: "set-sysplus-role", guildId: message.guild.id, roleId: role.id, actorId: message.author.id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      settings.sysPlus = { ...(settings.sysPlus ?? {}), roleId: role.id };
      record("sysplus_role_updated");
      await message.reply(`✅ Le rôle **${role.name}** est maintenant le rôle Perm Sys+ de ce serveur. La configuration est enregistrée sur le site.${result.auditRecorded === false ? " ⚠️ L’audit n’a pas pu être enregistré." : ""}`);
    } catch {
      await message.reply("❌ Impossible d'enregistrer le rôle dans Supabase via le site. Vérifie la synchronisation et réessaie.");
    }
    return true;
  }

  if (!isSysPlus(message.member, roleId)) {
    await message.reply("⛔ Accès réservé au rôle Perm Sys+.");
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("SYS+ — Centre de contrôle")
    .setDescription("Le noyau SYS+ est actif. Les modules apparaîtront ici au fur et à mesure de leur livraison.")
    .addFields(
      { name: "Serveur", value: message.guild.name, inline: true },
      { name: "Rôle Perm Sys+", value: roleId ? `<@&${roleId}>` : "Non configuré", inline: true },
      { name: "Commandes disponibles", value: "`=sysp` — ouvrir ce panneau\n`=sysp role @Rôle` — configurer le rôle (propriétaire / administrateur)" },
      { name: "Modules disponibles", value: "Commandes vocales `=access` / `=panel` / `=pv` : actives\nDOG surnom et rappel vocal : actifs\nMusique YouTube : active" },
      { name: "En développement", value: "Économie PND, boutique et mini-jeux\nPermissions SYS+ avancées" }
    )
    .setFooter({ text: "Her? V2 • Accès contrôlé par identifiant de rôle Discord" });
  await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  return true;
}

export async function handleSysPlusInteraction(interaction, settings, { apiUrl, secret, record }) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "sysp") return false;

  const subcommand = interaction.options.getSubcommand();
  const guild = interaction.guild;

  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
    return true;
  }

  const member = await guild.members.fetch(interaction.user.id);
  const roleId = settings?.[guild.id]?.sysPlus?.roleId ?? null;

  if (subcommand === "role") {
    if (!canConfigureSysPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le propriétaire ou un administrateur peut configurer ce rôle.", ephemeral: true });
      return true;
    }

    const role = interaction.options.getRole("role", true);

    if (role.managed || role.id === guild.id) {
      await interaction.reply({ content: "❌ Ce rôle ne peut pas être utilisé.", ephemeral: true });
      return true;
    }

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: AUTH(secret),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          action: "set-sysplus-role",
          guildId: guild.id,
          roleId: role.id,
          actorId: interaction.user.id,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      settings[guild.id] ??= {};
      settings[guild.id].sysPlus = { ...(settings[guild.id].sysPlus ?? {}), roleId: role.id };
      record("sysplus_role_updated");

      await interaction.reply({
        content: `✅ Le rôle **${role.name}** est maintenant le rôle Perm SYS+.${result.auditRecorded === false ? " ⚠️ Audit non enregistré." : ""}`,
        ephemeral: true,
      });
    } catch {
      await interaction.reply({ content: "❌ Impossible d'enregistrer le rôle. Vérifie la synchronisation du site.", ephemeral: true });
    }

    return true;
  }

  if (subcommand === "panel") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("SYS+ — Centre de contrôle")
      .setDescription("Le noyau SYS+ est actif.")
      .addFields(
        { name: "Serveur", value: guild.name, inline: true },
        { name: "Rôle Perm SYS+", value: roleId ? `<@&${roleId}>` : "Non configuré", inline: true },
        { name: "Commandes disponibles", value: "`=access` · `=panel` · `=pv` · DOG · Musique YouTube" },
        { name: "En développement", value: "Permissions SYS+ avancées" }
      )
      .setFooter({ text: "Her? V3 • SYS+" });

    await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }

  await interaction.reply({ content: "Sous-commande SYS+ inconnue.", ephemeral: true });
  return true;
}
