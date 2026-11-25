// FWU — garde centrale des attributions de rôles (les 5 bots).
//
// Un rôle est « protégé » quand le recevoir donne du pouvoir :
//   • il porte une permission Discord sensible (Administrateur, Bannir, Gérer les rôles…) ;
//   • il est associé à un palier 0 % ou de modération (1, 5, 10, 50 %) par /quota palier ;
//   • c'est le rôle SYS+, ADMIN+ ou WHITELIST configuré.
// Le NOM d'un rôle n'est jamais regardé : seuls son identifiant et ses permissions comptent.
//
// Qui peut donner un rôle protégé ?
//   • les commandes manuelles (=rank, /roletemp, /staff promouvoir…) : l'OWNER configuré
//     (PND_OWNER_DISCORD_ID) seulement ;
//   • les attributions automatiques (boutique, niveaux, réaction, CAPTCHA, rôle automatique,
//     règles d'automatisation, anniversaire, couleur de pseudo) : personne, jamais.
// Les restaurations (fin de quarantaine, DOG, rôle 0 % remis) ne passent pas par ici :
// elles rendent au membre des rôles qu'il avait déjà.
import { PermissionFlagsBits as P } from "discord.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { canUseModeration, loadRoleTiersStrict } from "./shared/tiers.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";

/** Permissions qui donnent un pouvoir sur les membres, les rôles ou le serveur. */
export const PRIVILEGED_PERMISSIONS = Object.freeze([
  ["Administrator", P.Administrator],
  ["ManageGuild", P.ManageGuild],
  ["ManageRoles", P.ManageRoles],
  ["ManageChannels", P.ManageChannels],
  ["ManageWebhooks", P.ManageWebhooks],
  ["BanMembers", P.BanMembers],
  ["KickMembers", P.KickMembers],
  ["ModerateMembers", P.ModerateMembers],
  ["ManageMessages", P.ManageMessages],
  ["MentionEveryone", P.MentionEveryone],
  ["ManageNicknames", P.ManageNicknames],
  ["ManageGuildExpressions", P.ManageGuildExpressions],
  ["ManageEvents", P.ManageEvents],
  ["ManageThreads", P.ManageThreads],
  ["MoveMembers", P.MoveMembers],
  ["MuteMembers", P.MuteMembers],
  ["DeafenMembers", P.DeafenMembers],
  ["ViewAuditLog", P.ViewAuditLog],
]);

function toBits(value) {
  try {
    return BigInt(value?.bitfield ?? value ?? 0);
  } catch {
    return null;
  }
}

/** Noms des permissions sensibles contenues dans un bitfield (illisible → ["inconnues"]). */
export function privilegedPermissionNames(permissions) {
  if (permissions && typeof permissions === "object" && permissions.bitfield === undefined && typeof permissions.has === "function") {
    try {
      return PRIVILEGED_PERMISSIONS.filter(([, bit]) => permissions.has(bit)).map(([name]) => name);
    } catch {
      return ["inconnues"];
    }
  }
  const bits = toBits(permissions);
  if (bits === null) return ["inconnues"];
  return PRIVILEGED_PERMISSIONS.filter(([, bit]) => (bits & bit) === bit).map(([name]) => name);
}

/** Retire les permissions sensibles d'un bitfield (restaurations, Server Clone). */
export function stripPrivilegedPermissions(permissions) {
  let bits = toBits(permissions) ?? 0n;
  const stripped = [];
  for (const [name, bit] of PRIVILEGED_PERMISSIONS) {
    if ((bits & bit) !== 0n) {
      stripped.push(name);
      bits &= ~bit;
    }
  }
  return { permissions: bits.toString(), stripped };
}

/** Rôles SYS+ / ADMIN+ / WHITELIST configurés pour ce serveur. */
export function accessRoleIds(guildId, settings = null) {
  let adminPlus = settings?.adminPlus?.roleId ?? null;
  if (!adminPlus && guildId) {
    try { adminPlus = getAdminPlusRoleId(guildId); } catch { adminPlus = null; }
  }
  return {
    sysPlus: settings?.sysPlus?.roleId ?? null,
    adminPlus,
    whitelist: settings?.sysPlus?.whitelistRoleId ?? null,
  };
}

/**
 * Décision pure. `role` = { id, managed, permissions }, `tiers` = Map(roleId → palier),
 * `access` = { sysPlus, adminPlus, whitelist }. Retourne la raison du refus, ou null.
 */
export function protectedRoleReason({ role, guildId, tiers = new Map(), access = {}, removal = false }) {
  if (!role?.id) return "Rôle introuvable.";
  if (role.id === guildId || role.managed) return "Ce rôle est protégé ou géré par une intégration.";
  if (role.id === access.sysPlus) return "Le rôle SYS+ ne se donne qu'avec /sysp add (OWNER).";
  if (role.id === access.adminPlus) return "Le rôle ADMIN+ ne se donne que par l'OWNER.";
  if (role.id === access.whitelist) return "Le rôle WHITELIST ne se donne qu'avec /sysp whitelist (OWNER).";
  if (tiers instanceof Map && tiers.has(role.id)) {
    const tier = tiers.get(role.id);
    if (tier === 0 || canUseModeration(tier)) return `Ce rôle donne le palier ${tier} % : seul l'OWNER peut le donner.`;
  }
  // Retirer un rôle à permissions n'élève personne : seuls les rôles d'accès et de palier
  // restent réservés à l'OWNER dans ce sens.
  if (removal) return null;
  const dangerous = privilegedPermissionNames(role.permissions);
  if (dangerous.length) return `Ce rôle porte des permissions sensibles (${dangerous.join(", ")}) : seul l'OWNER peut le donner.`;
  return null;
}

/**
 * Raison de refus pour donner `role` sur `guild`, ou null.
 * `actorId` : membre derrière l'action ; seul l'OWNER configuré passe outre (sauf `automatic`).
 * Si les paliers sont illisibles (base centrale en panne, sans cache), on refuse par sécurité.
 */
export async function roleGrantRefusal(guild, role, { actorId = null, settings = null, automatic = false, removal = false, env = process.env } = {}) {
  if (!guild?.id) return "Serveur introuvable.";
  const owner = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (!automatic && owner && actorId === owner) {
    return role?.id && role.id !== guild.id && !role.managed ? null : "Ce rôle est protégé ou géré par une intégration.";
  }
  let tiers;
  try {
    tiers = await loadRoleTiersStrict(guild.id, env);
  } catch {
    return "Paliers illisibles (base centrale indisponible) : attribution refusée par sécurité.";
  }
  return protectedRoleReason({ role, guildId: guild.id, tiers, access: accessRoleIds(guild.id, settings), removal });
}

/** Comme roleGrantRefusal, mais lève une Error lisible. */
export async function assertRoleGrantable(guild, role, options = {}) {
  const reason = await roleGrantRefusal(guild, role, options);
  if (reason) throw new Error(reason);
}

/**
 * Attributions automatiques : ne garde que les rôles donnables (ids). Un rôle protégé,
 * introuvable ou une base des paliers illisible → retiré de la liste, avec `onRefused(roleId, raison)`.
 */
export async function filterGrantableRoleIds(guild, roleIds, { settings = null, onRefused = () => {} } = {}) {
  const allowed = [];
  for (const roleId of roleIds ?? []) {
    const role = guild?.roles?.cache?.get?.(roleId) ?? (await guild?.roles?.fetch?.(roleId).catch(() => null));
    const reason = role ? await roleGrantRefusal(guild, role, { automatic: true, settings }) : "Rôle introuvable.";
    if (reason) {
      try { onRefused(roleId, reason); } catch { /* le journal ne débloque jamais */ }
      continue;
    }
    allowed.push(roleId);
  }
  return allowed;
}
