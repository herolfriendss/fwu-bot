import { PermissionFlagsBits } from "discord.js";

/** Fail closed unless the member is the guild owner, a Discord administrator,
 * or holds the configured SYS+ role ID. Role names are never trusted. */
export function isSysPlus(member, roleId) {
  if (!member?.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return Boolean(roleId && member.roles?.cache?.has(roleId));
}

export function canConfigureSysPlus(member) {
  return Boolean(member?.guild && (
    member.id === member.guild.ownerId ||
    member.permissions?.has(PermissionFlagsBits.Administrator)
  ));
}
