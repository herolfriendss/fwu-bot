// FWU — hierarchy rule shared by every bot, applied before any command that acts on a member.
//
// A staff member can only act on members whose highest role is strictly BELOW theirs.
// Full access: the configured OWNER (PND_OWNER_DISCORD_ID) and the Discord server owner.
// Nobody but the OWNER can target the OWNER; the server owner is never a target either.
// The rule runs centrally in interactionCreate, so a module can never forget it; modules
// keep their own checks (bot rank, Discord permissions) on top.
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { SLASH_FOR_PREFIX } from "./prefix-to-slash.js";

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
  ...Object.fromEntries(["perroquet", "fantome", "mime", "clown", "robot", "bebe", "yoda", "chuchote", "sablier", "malediction",
    "sourdine-folle", "exil", "bouffon", "patate", "tribunal", "interrogatoire", "taxe", "rancon", "cible"].map((kind) => [`malus ${kind}`, "membre"])),
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
  "blr poser": "membre",
  "blr lever": "membre",
});

export const HIERARCHY_MESSAGES = Object.freeze({
  owner: "⛔ Cette personne est l'OWNER : personne d'autre ne peut agir sur elle.",
  guildOwner: "⛔ Le propriétaire du serveur ne peut pas être visé.",
  notLower: "⛔ Tu ne peux agir que sur un membre dont le rôle le plus élevé est en dessous du tien.",
  targetMissing: "⛔ Ce membre n'est pas présent sur le serveur : cette commande exige un membre présent.",
  unreadable: "⛔ Hiérarchie des rôles illisible : action refusée par sécurité.",
});

const ABSENT_TARGET_ALLOWED_PATHS = new Set(["ban", "blacklist add"]);

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

/** Discord error codes meaning "this user is not (or no longer) a member of the server". */
export const ABSENT_MEMBER_CODES = Object.freeze(new Set([10007, 10013]));

/**
 * Reads a member and tells "absent from the server" apart from "could not read".
 * Fail closed: any error other than Unknown Member / Unknown User (rate limit, network,
 * missing access) is reported as `unreadable`, never as "absent".
 * @returns {Promise<{ state: "member", member: any } | { state: "absent" } | { state: "unreadable" }>}
 */
export async function readMemberState(guild, userId) {
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    if (member) return { state: "member", member };
    return { state: "absent" };
  } catch (error) {
    const code = Number(error?.code ?? error?.rawError?.code);
    return ABSENT_MEMBER_CODES.has(code) ? { state: "absent" } : { state: "unreadable" };
  }
}

/** Shared core: refusal text for `actorId` acting on `targetId` in `guild`, or null. */
export async function checkTargetHierarchy(guild, actorId, targetId, { pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID), path = null } = {}) {
  if (!guild || !targetId) return null;
  if (hasFullAccess(actorId, { guildOwnerId: guild.ownerId, pndOwnerId }) && targetId !== pndOwnerId) return null;
  const [actorState, targetState] = await Promise.all([readMemberState(guild, actorId), readMemberState(guild, targetId)]);
  const actor = actorState.state === "member" ? actorState.member : null;
  const position = (member) => {
    const value = member?.roles?.highest?.position;
    return Number.isFinite(value) ? value : NaN;
  };
  if (actorState.state !== "member" || targetState.state === "unreadable") return HIERARCHY_MESSAGES.unreadable;
  if (targetState.state === "absent" && !ABSENT_TARGET_ALLOWED_PATHS.has(path)) {
    const protectedTarget = decideHierarchy({
      actorId, targetId, actorPosition: position(actor), targetPosition: null,
      guildOwnerId: guild.ownerId, pndOwnerId,
    });
    return protectedTarget ?? HIERARCHY_MESSAGES.targetMissing;
  }
  return decideHierarchy({
    actorId,
    targetId,
    actorPosition: position(actor),
    // An absent target is allowed only for explicit ID-based ban/blacklist operations.
    targetPosition: targetState.state === "absent" ? null : position(targetState.member),
    guildOwnerId: guild.ownerId,
    pndOwnerId,
  });
}

/** Returns a refusal text, or null when the command may continue. Never mutates anything. */
export async function checkInteractionHierarchy(interaction, { pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) } = {}) {
  if (!interaction?.isChatInputCommand?.() || !interaction.guild) return null;
  const option = HIERARCHY_TARGETS[commandPath(interaction)];
  if (!option) return null;
  const user = interaction.options.getUser?.(option, false);
  if (!user) return null;
  return checkTargetHierarchy(interaction.guild, interaction.user?.id, user.id, { pndOwnerId, path: commandPath(interaction) });
}

/**
 * Slash path a canonical prefix command ("=rank @x", "=sysp add @x") stands for, when
 * that path targets a member (HIERARCHY_TARGETS); otherwise null.
 */
export function prefixHierarchyPath(canonical, slashForPrefix = SLASH_FOR_PREFIX) {
  const words = String(canonical ?? "").trim().split(/\s+/);
  const token = (words.shift() ?? "").replace(/^=/, "").toLowerCase();
  const base = slashForPrefix[token];
  if (!base) return null;
  const args = words.filter((word) => /^[a-z-]+$/i.test(word)).map((word) => word.toLowerCase());
  const candidates = [base, `${base} ${args[0] ?? ""}`.trim(), `${base} ${args[0] ?? ""} ${args[1] ?? ""}`.trim()];
  return candidates.find((path) => HIERARCHY_TARGETS[path]) ?? null;
}

/** First member a prefix command aims at: a user mention, else a bare Discord ID. */
export function prefixTargetId(canonical) {
  const text = String(canonical ?? "");
  const mention = text.match(/<@!?(\d{17,20})>/);
  if (mention) return mention[1];
  const bare = text.replace(/<@&\d+>|<#\d+>/g, " ").match(/(?:^|\s)(\d{17,20})(?=\s|$)/);
  return bare ? bare[1] : null;
}

/**
 * Same rule for prefix commands ("=dog @x", "=wakeup @x"…): the slash guard never sees
 * them, so the message router calls this once, before any module.
 */
export async function checkPrefixHierarchy(message, canonical, options = {}) {
  if (!message?.guild || !message.author?.id) return null;
  if (!prefixHierarchyPath(canonical)) return null;
  const targetId = prefixTargetId(canonical);
  if (!targetId) return null;
  return checkTargetHierarchy(message.guild, message.author.id, targetId, { ...options, path: prefixHierarchyPath(canonical) });
}
