/**
 * DOG moderation must respect Discord's role order.
 * The guild owner is the sole human hierarchy override; bot hierarchy is
 * checked independently by the command handler before any mutation.
 */
export function canApplyDogAction(actor, target, guildOwnerId) {
  if (!actor?.id || !target?.id || actor.id === target.id) return false;
  if (actor.id === guildOwnerId) return true;
  const actorHighest = actor.roles?.highest;
  const targetHighest = target.roles?.highest;
  if (!actorHighest || !targetHighest || typeof actorHighest.comparePositionTo !== "function") return false;
  return actorHighest.comparePositionTo(targetHighest) > 0;
}

export function isBotAboveDogTarget(botMember, target) {
  const botHighest = botMember?.roles?.highest;
  const targetHighest = target?.roles?.highest;
  if (!botHighest || !targetHighest || typeof botHighest.comparePositionTo !== "function") return false;
  return botHighest.comparePositionTo(targetHighest) > 0;
}
