import { PermissionFlagsBits } from "discord.js";

export function hasAnyConfiguredRole(member, roleIds = []) {
  return Array.isArray(roleIds) && roleIds.some((id) => member?.roles?.cache?.has(id));
}

export function canUseModeration(member, guildOwnerId, sysPlusRoleId, allowedRoleIds = []) {
  if (!member?.id) return false;
  if (member.id === guildOwnerId) return true;
  if (sysPlusRoleId && member.roles?.cache?.has(sysPlusRoleId)) return true;
  return hasAnyConfiguredRole(member, allowedRoleIds);
}

export function isProtectedMember(member, guildOwnerId, protectRoleId, untouchableRoleIds = []) {
  if (!member?.id) return false;
  if (member.id === guildOwnerId) return true;
  return Boolean(
    (protectRoleId && member.roles?.cache?.has(protectRoleId)) ||
    hasAnyConfiguredRole(member, untouchableRoleIds),
  );
}

export function nextProtectStrike(current) {
  return Math.min(3, Math.max(0, Number(current) || 0) + 1);
}

export function protectStrikeAction(strike) {
  if (strike <= 1) return "warn";
  if (strike === 2) return "timeout";
  return "derank";
}

export function isStrictlyAbove(actor, target) {
  const actorHighest = actor?.roles?.highest;
  const targetHighest = target?.roles?.highest;
  if (!actorHighest || !targetHighest || typeof actorHighest.comparePositionTo !== "function") return false;
  return actorHighest.comparePositionTo(targetHighest) > 0;
}

export function botCanModerate(botMember, target) {
  return isStrictlyAbove(botMember, target);
}
