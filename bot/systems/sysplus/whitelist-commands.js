import { PermissionFlagsBits } from "discord.js";
import { recordSysPlusAudit } from "./audit.js";
import {
  canManageWhitelist,
  isValidWhitelistRole,
  WHITELIST_ROLE_NAME,
} from "./whitelist-policy.js";

const noMentions = { parse: [] };

export async function handleWhitelistInteraction(interaction, settings, { audit = () => {} } = {}) {
  if (!interaction.isChatInputCommand?.()) return false;
  const action = interaction.commandName === "sysp"
    ? interaction.options.getSubcommand(false)
    : ({ "whitelist-add": "whitelist-add", "whitelist-remove": "whitelist-remove", "whitelist-list": "whitelist-list" })[interaction.commandName];
  if (!["whitelist-add", "whitelist-remove", "whitelist-list"].includes(action)) return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "Cette commande est réservée à un serveur.",
      ephemeral: true,
    });
    return true;
  }

  const actor = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  const owner = await guild.fetchOwner().catch(() => null);
  if (!actor || !owner || !canManageWhitelist(actor.id, owner.id, guild.id)) {
    await interaction.reply({
      content: "⛔ Seul le propriétaire du serveur peut gérer WHITELIST.",
      ephemeral: true,
    });
    return true;
  }

  const roleId = settings?.[guild.id]?.sysPlus?.whitelistRoleId;
  const role = roleId ? await guild.roles.fetch(roleId, { force: true }).catch(() => null) : null;
  if (!role || role.name !== WHITELIST_ROLE_NAME) {
    await interaction.reply({
      content: "Configure d’abord le rôle exact **WHITELIST** avec `/sysp whitelist-role`.",
      ephemeral: true,
    });
    return true;
  }

  if (action === "whitelist-list") {
    const members = [...role.members.values()];
    const description = members.length
      ? members
          .slice(0, 50)
          .map((member) => `• <@${member.id}>`)
          .join("\n")
      : "Aucun membre WHITELIST.";
    await interaction.reply({
      content: `**WHITELIST · ${members.length} membre(s) présents dans le cache du bot**\n${description}\n\nCette liste reflète le cache Discord du processus et peut être incomplète.`,
      ephemeral: true,
      allowedMentions: noMentions,
    });
    recordSysPlusAudit(guild.id, actor.id, "whitelist.list", null, { cachedCount: members.length, complete: false });
    audit(
      guild,
      "WHITELIST — consultation",
      `Propriétaire : <@${actor.id}>\nMembres affichés : ${members.length}`,
    );
    return true;
  }

  const targetUser = interaction.options.getUser("membre", true);
  const target = await guild.members.fetch({ user: targetUser.id, force: true }).catch(() => null);
  if (!target) {
    await interaction.reply({
      content: "❌ Ce membre ne se trouve pas sur ce serveur.",
      ephemeral: true,
    });
    return true;
  }
  const bot = await guild.members.fetchMe({ force: true });
  if (
    !bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
    !isValidWhitelistRole(role, guild.id, bot.roles.highest.position)
  ) {
    await interaction.reply({
      content: "❌ Le bot doit pouvoir gérer le rôle WHITELIST, placé sous son rôle le plus élevé.",
      ephemeral: true,
    });
    return true;
  }

  if (action === "whitelist-add") {
    if (target.roles.cache.has(role.id)) {
      await interaction.reply({
        content: "Ce membre possède déjà le rôle WHITELIST.",
        ephemeral: true,
      });
      return true;
    }
    await target.roles.add(role, `WHITELIST attribuée par le propriétaire ${actor.id}`);
  } else {
    if (!target.roles.cache.has(role.id)) {
      await interaction.reply({
        content: "Ce membre ne possède pas le rôle WHITELIST.",
        ephemeral: true,
      });
      return true;
    }
    await target.roles.remove(role, `WHITELIST retirée par le propriétaire ${actor.id}`);
  }

  const auditAction = action === "whitelist-add" ? "whitelist.add" : "whitelist.remove";
  recordSysPlusAudit(guild.id, actor.id, auditAction, target.id, { roleId: role.id });
  audit(
    guild,
    `WHITELIST — ${action === "whitelist-add" ? "attribution" : "retrait"}`,
    `Propriétaire : <@${actor.id}>\nMembre : <@${target.id}>\nRôle : <@&${role.id}>`,
  );
  await interaction.reply({
    content:
      action === "whitelist-add"
        ? `✅ WHITELIST attribuée à <@${target.id}>.`
        : `✅ WHITELIST retirée à <@${target.id}>.`,
    ephemeral: true,
    allowedMentions: noMentions,
  });
  return true;
}
