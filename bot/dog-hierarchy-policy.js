/**
 * DOG moderation must respect Discord's role order.
 * The leash marker role is ignored when evaluating the target's real hierarchy,
 * otherwise it could prevent the owner from removing an existing leash.
 */
function highestRole(member, ignoredRoleId = null) {
  const cache = member?.roles?.cache;
  if (!cache || typeof cache.values !== "function") return null;
  const roles = [...cache.values()].filter((role) => role?.id !== ignoredRoleId);
  const everyone = member.guild?.roles?.everyone;
  if (everyone && everyone.id !== ignoredRoleId && !roles.some((role) => role.id === everyone.id)) {
    roles.push(everyone);
  }
  return roles.reduce((highest, role) =>
    !highest || role.comparePositionTo(highest) > 0 ? role : highest, null);
}

export function canApplyDogAction(actor, target, guildOwnerId, ignoredTargetRoleId = null) {
  if (!actor?.id || !target?.id || actor.id === target.id) return false;
  if (actor.id === guildOwnerId) return true;
  const actorHighest = highestRole(actor);
  const targetHighest = highestRole(target, ignoredTargetRoleId);
  if (!actorHighest || !targetHighest || typeof actorHighest.comparePositionTo !== "function") return false;
  return actorHighest.comparePositionTo(targetHighest) > 0;
}

export function isBotAboveDogTarget(botMember, target) {
  const botHighest = highestRole(botMember);
  const targetHighest = highestRole(target);
  if (!botHighest || !targetHighest || typeof botHighest.comparePositionTo !== "function") return false;
  return botHighest.comparePositionTo(targetHighest) > 0;
}


/** Only the configured SYS+ role or the server owner may release a DOG leash. */
export function canRemoveDogLeash(member, guildOwnerId, sysPlusRoleId) {
  if (!member?.id) return false;
  if (member.id === guildOwnerId) return true;
  return typeof sysPlusRoleId === "string"
    && /^\\d{5,25}$/.test(sysPlusRoleId)
    && sysPlusRoleId !== member.guild?.id
    && Boolean(member.roles?.cache?.has(sysPlusRoleId));
}
