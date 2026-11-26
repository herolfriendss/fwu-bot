// FWU — hierarchy rule shared by every bot, applied before any command that acts on a member.
//
// A staff member can only act on members whose highest role is strictly BELOW theirs.
// Full access: the configured OWNER (PND_OWNER_DISCORD_ID) and the Discord server owner.
// Nobody but the OWNER can target the OWNER; the server owner is never a target either.
// The rule runs centrally in interactionCreate, so a module can never forget it; modules
// keep their own checks (bot rank, Discord permissions) on top.
import { parsePndOwnerId } from "./pnd-owner-policy.js";

/** "command[ group] sub" → option holding the targeted member. */
export const HIERARCHY_TARGETS = Object.freeze({
  warn: "membre",
  tempmute: "membre",
  unmute: "membre",
  kick: "membre",
  ban: "membre",
  removerole: "membre",
  rank: "membre",
  "sysp add": "membre",
  "sysp remove": "membre",
  "sysp incident": "membre",
  "sysp staff supervisor-set": "membre",
  "sysp staff supervisor-remove": "membre",
  "sysp whitelist whitelist-add": "membre",
  "sysp whitelist whitelist-remove": "membre",
  "pnd ajouter": "membre",
  "pnd retirer": "membre",
  "pnd definir": "membre",
  "anti-moove proteger": "membre",
  "anti-moove retirer": "membre",
  "anti-moove exception-ajouter": "membre",
  "anti-moove exception-retirer": "membre",
  wakeup: "membre",
  dog: "membre",
  undog: "membre",
  "lockname proteger": "membre",
  "lockname retirer": "membre",
  "wouaf activer": "membre",
  "wouaf stop": "membre",
  menotte: "membre",
  unmenotte: "membre",
  "blacklist add": "membre",
  "rolepanel membre": "membre",
  "quarantaine ajouter": "membre",
  "quarantaine retirer": "membre",
  "roletemp donner": "membre",
  "roletemp retirer": "membre",
  "staff promouvoir": "membre",
  "staff retrograder": "membre",
  "pseudo changer": "membre",
  "pseudo reset": "membre",
  "voc expulser": "membre",
  "voc bloquer": "membre",
});

export const HIERARCHY_MESSAGES = Object.freeze({
  owner: "⛔ Cette personne est l'OWNER : personne d'autre ne peut agir sur elle.",
  guildOwner: "⛔ Le propriétaire du serveur ne peut pas être visé.",
  notLower: "⛔ Tu ne peux agir que sur un membre dont le rôle le plus élevé est en dessous du tien.",
  targetMissing: "⛔ Ce membre n'est pas présent sur le serveur : cette commande exige un membre présent.",
  unreadable: "⛔ Hiérarchie des rôles illisible : action refusée par sécurité.",
});

export function commandPath(interaction) {
  const o = interaction?.options;
  return [interaction?.commandName, o?.getSubcommandGroup?.(false), o?.getSubcommand?.(false)].filter(Boolean).join(" ");
}

export function hasFullAccess(actorId, { guildOwnerId = null, pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) } = {}) {
  return Boolean(actorId) && (actorId === pndOwnerId || actorId === guildOwnerId);
}

/**
 * Pure decision. Positions are the members' highest role positions; a target that is not
 * on the server (targetPosition null, e.g. a ban by ID) has no rank to compare.
 * Self-targeting is left to each command (some allow it, some refuse it).
 */
export function decideHierarchy({ actorId, targetId, actorPosition, targetPosition, guildOwnerId = null, pndOwnerId = null }) {
  if (!targetId || targetId === actorId) return null;
  if (pndOwnerId && targetId === pndOwnerId) return HIERARCHY_MESSAGES.owner;
  if (guildOwnerId && targetId === guildOwnerId && actorId !== pndOwnerId) return HIERARCHY_MESSAGES.guildOwner;
  if (hasFullAccess(actorId, { guildOwnerId, pndOwnerId })) return null;
  if (targetPosition === null || targetPosition === undefined) return null;
  if (!Number.isFinite(actorPosition) || !Number.isFinite(targetPosition)) return HIERARCHY_MESSAGES.unreadable;
  return targetPosition < actorPosition ? null : HIERARCHY_MESSAGES.notLower;
}

const ABSENT_TARGET_ALLOWED_PATHS = new Set(["ban", "blacklist add"]);

function isUnknownGuildMember(error) {
  return Number(error?.code ?? error?.rawError?.code) === 10007;
}

async function fetchHierarchyMember(guild, userId) {
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    return member ? { member } : { error: new Error("Member lookup returned no member") };
  } catch (error) {
    return isUnknownGuildMember(error) ? { absent: true } : { error };
  }
}

/** Returns a refusal text, or null when the command may continue. Never mutates anything. */
export async function checkInteractionHierarchy(interaction, { pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) } = {}) {
  if (!interaction?.isChatInputCommand?.() || !interaction.guild) return null;
  const path = commandPath(interaction);
  const option = HIERARCHY_TARGETS[path];
  if (!option) return null;
  const user = interaction.options.getUser?.(option, false);
  if (!user) return null;
  const guild = interaction.guild;
  const actorId = interaction.user?.id;
  if (hasFullAccess(actorId, { guildOwnerId: guild.ownerId, pndOwnerId }) && user.id !== pndOwnerId) return null;

  const [actorResult, targetResult] = await Promise.all([
    fetchHierarchyMember(guild, actorId),
    fetchHierarchyMember(guild, user.id),
  ]);
  // A failed actor lookup or any target lookup error other than Discord's explicit
  // Unknown Member response makes hierarchy unverifiable. Never turn an API outage
  // into permission to act on an ID-only target.
  if (actorResult.error || !actorResult.member || targetResult.error) {
    return HIERARCHY_MESSAGES.unreadable;
  }

  const position = (member) => {
    const value = member?.roles?.highest?.position;
    return Number.isFinite(value) ? value : NaN;
  };
  if (targetResult.absent && !ABSENT_TARGET_ALLOWED_PATHS.has(path)) {
    const protectedTarget = decideHierarchy({
      actorId, targetId: user.id, actorPosition: position(actorResult.member),
      targetPosition: null, guildOwnerId: guild.ownerId, pndOwnerId,
    });
    return protectedTarget ?? HIERARCHY_MESSAGES.targetMissing;
  }
  return decideHierarchy({
    actorId,
    targetId: user.id,
    actorPosition: position(actorResult.member),
    targetPosition: targetResult.absent ? null : position(targetResult.member),
    guildOwnerId: guild.ownerId,
    pndOwnerId,
  });
}
