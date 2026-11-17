// Her? V5 — règles de protection et d'autorisation de modération.
// Fonctions pures afin de pouvoir les tester sans connexion Discord.

export function hasAnyConfiguredRole(member, roleIds = []) {
  const everyoneId = member?.guild?.id;
  return Array.isArray(roleIds) && roleIds.some((id) => id && id !== everyoneId && member?.roles?.cache?.has(id));
}

export function canUseModeration(member, guildOwnerId, sysPlusRoleId, allowedRoleIds = []) {
  if (!member?.id) return false;
  if (member.id === guildOwnerId) return true;
  if (sysPlusRoleId && sysPlusRoleId !== member.guild?.id && member.roles?.cache?.has(sysPlusRoleId)) return true;
  return hasAnyConfiguredRole(member, allowedRoleIds);
}

export function isProtectedMember(member, guildOwnerId, protectRoleId, untouchableRoleIds = []) {
  if (!member?.id) return false;
  if (member.id === guildOwnerId) return true;
  return Boolean(
    (protectRoleId && protectRoleId !== member.guild?.id && member.roles?.cache?.has(protectRoleId)) ||
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

/** Returns only configured staff roles that the bot can safely remove. */
export function getRemovableConfiguredRoleIds(actor, botMember, roleIds = []) {
  const botHighest = botMember?.roles?.highest;
  const actorHighest = actor?.roles?.highest;
  const actorRoles = actor?.roles?.cache;
  if (
    !botHighest ||
    !actorHighest ||
    typeof botHighest.comparePositionTo !== "function" ||
    typeof actorRoles?.get !== "function" ||
    botHighest.comparePositionTo(actorHighest) <= 0
  ) return [];
  return [...new Set((Array.isArray(roleIds) ? roleIds : []).filter(Boolean))].filter((id) => {
    const role = actorRoles.get(id);
    return Boolean(
      role && role.managed !== true && role.id !== actor?.guild?.id && botHighest.comparePositionTo(role) > 0,
    );
  });
}
