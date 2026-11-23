/**
 * Shared hierarchy guard for actions that restrict another member (DOG, MENOTTE).
 *
 * Internal 1942 permissions never override Discord's native role hierarchy:
 *  - nobody restricts themselves, the Discord server owner, or the configured PND OWNER;
 *  - the bot's highest role must be strictly above the target's highest role;
 *  - the actor's highest role must be strictly above the target's, unless the
 *    actor is the Discord server owner (who natively outranks every role).
 *
 * The function is pure and performs no Discord call, so a refusal can never
 * leave a partial mutation behind. Callers must run it BEFORE any change.
 */
export const HIERARCHY_CODES = Object.freeze({
  TARGET_MISSING: "target_missing",
  SELF: "self",
  PROTECTED_OWNER: "protected_owner",
  UNREADABLE: "unreadable_hierarchy",
  BOT_BELOW_TARGET: "bot_below_target",
  TARGET_NOT_LOWER: "target_not_lower",
});

const REASONS = Object.freeze({
  [HIERARCHY_CODES.TARGET_MISSING]:
    "Je ne trouve pas ce membre sur le serveur.",
  [HIERARCHY_CODES.SELF]: "Tu ne peux pas appliquer cette action sur toi-même.",
  [HIERARCHY_CODES.PROTECTED_OWNER]:
    "Cette personne est protégée (propriétaire) : action refusée.",
  [HIERARCHY_CODES.UNREADABLE]:
    "Hiérarchie des rôles illisible : action refusée par sécurité.",
  [HIERARCHY_CODES.BOT_BELOW_TARGET]:
    "Je ne peux pas modifier ce membre : son rôle atteint ou dépasse le rôle le plus élevé du bot.",
  [HIERARCHY_CODES.TARGET_NOT_LOWER]:
    "Tu ne peux agir que sur un membre dont le rôle le plus élevé est inférieur au tien.",
});

function position(member) {
  const value = member?.roles?.highest?.position;
  return Number.isFinite(value) ? value : null;
}

function refuse(code) {
  return { allowed: false, code, reason: REASONS[code] };
}

export function evaluateTargetHierarchy({
  actor,
  target,
  bot,
  guildOwnerId = null,
  pndOwnerId = null,
  enforceActorRank = true,
  allowSelf = false,
}) {
  if (!target?.id) return refuse(HIERARCHY_CODES.TARGET_MISSING);
  if (!allowSelf && actor?.id && target.id === actor.id)
    return refuse(HIERARCHY_CODES.SELF);
  if (
    (guildOwnerId && target.id === guildOwnerId) ||
    (pndOwnerId && target.id === pndOwnerId)
  ) {
    return refuse(HIERARCHY_CODES.PROTECTED_OWNER);
  }

  const targetPosition = position(target);
  const botPosition = position(bot);
  if (targetPosition === null || botPosition === null)
    return refuse(HIERARCHY_CODES.UNREADABLE);
  if (targetPosition >= botPosition)
    return refuse(HIERARCHY_CODES.BOT_BELOW_TARGET);

  if (enforceActorRank && !(guildOwnerId && actor?.id === guildOwnerId) && !(pndOwnerId && actor?.id === pndOwnerId)) {
    const actorPosition = position(actor);
    if (actorPosition === null) return refuse(HIERARCHY_CODES.UNREADABLE);
    if (targetPosition >= actorPosition)
      return refuse(HIERARCHY_CODES.TARGET_NOT_LOWER);
  }
  return { allowed: true, code: null, reason: null };
}
