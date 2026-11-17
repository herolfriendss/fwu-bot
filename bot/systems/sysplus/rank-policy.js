import { PermissionFlagsBits } from "discord.js";

/** SYS+ role holders, server owner and Discord administrators can use rank management. */
export function canUseRank(member, guildOwnerId, sysPlusRoleId) {
  if (!member?.id) return false;
  if (member.id === guildOwnerId) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return typeof sysPlusRoleId === "string"
    && /^\d{5,25}$/.test(sysPlusRoleId)
    && sysPlusRoleId !== member.guild?.id
    && Boolean(member.roles?.cache?.has(sysPlusRoleId));
}

/** Reject roles or targets the bot cannot safely manage under Discord's hierarchy. */
export function rankAssignmentError({ guildId, guildOwnerId, target, role, botMember }) {
  if (!guildId || !target?.id || !role?.id || !botMember?.id) return "Membre, rôle ou bot introuvable.";
  if (target.guild?.id !== guildId || role.guild?.id !== guildId || botMember.guild?.id !== guildId) {
    return "Le membre et le rôle doivent appartenir à ce serveur.";
  }
  if (target.id === guildOwnerId) return "Le propriétaire du serveur ne peut pas être modifié par cette commande.";
  if (role.id === guildId) return "Le rôle @everyone ne peut pas être attribué.";
  if (role.managed) return "Les rôles gérés par une intégration ou un bot ne peuvent pas être attribués manuellement.";
  if (!botMember.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return "Le bot doit avoir la permission Gérer les rôles.";
  }

  const botHighest = botMember.roles?.highest;
  const targetHighest = target.roles?.highest;
  if (!botHighest || !targetHighest || typeof botHighest.comparePositionTo !== "function") {
    return "Impossible de vérifier la hiérarchie des rôles.";
  }
  if (botHighest.comparePositionTo(role) <= 0) {
    return "Le rôle demandé doit être placé strictement sous le rôle le plus élevé du bot.";
  }
  if (botHighest.comparePositionTo(targetHighest) <= 0) {
    return "Le rôle le plus élevé du bot doit être supérieur à celui du membre ciblé.";
  }
  return null;
}
