// FWU — "staff du serveur": who may use staff-only community tools such as /sondage.
// The OWNER, the server owner, SYS+, ADMIN+, and members with a Discord moderation
// permission (Administrator, Manage Server or Manage Messages).
import { PermissionFlagsBits } from "discord.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { isAdminPlus, isSysPlus } from "./systems/sysplus/permissions.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";

export const STAFF_ONLY_MESSAGE = "🔒 Cette commande est réservée au staff du serveur.";

export function isServerStaff(member, guildSettings) {
  if (!member?.id || !member.guild) return false;
  if (member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member.id === member.guild.ownerId) return true;
  const sysPlusRoleId = guildSettings?.sysPlus?.roleId ?? null;
  if (isSysPlus(member, sysPlusRoleId)) return true;
  let adminPlusRoleId = null;
  try { adminPlusRoleId = getAdminPlusRoleId(member.guild.id); } catch { adminPlusRoleId = null; }
  if (isAdminPlus(member, sysPlusRoleId, adminPlusRoleId)) return true;
  const perms = member.permissions;
  return Boolean(perms?.has?.(PermissionFlagsBits.Administrator) || perms?.has?.(PermissionFlagsBits.ManageGuild) || perms?.has?.(PermissionFlagsBits.ManageMessages));
}
