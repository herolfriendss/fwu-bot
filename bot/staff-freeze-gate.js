// Gel d'urgence du staff, version élargie (idée SYS+ n°1, avis de l'Avocat du diable).
//
// Pendant un gel, un membre du STAFF (rôle SYS+, ADMIN+, WHITELIST, palier de modération
// explicite, ou permission Administrateur / Gérer le serveur / Gérer les rôles) ne peut plus :
//   • utiliser une commande slash des catégories staff (SYS+, Modération, Administration…) ni
//     les commandes de pouvoir listées ci-dessous (DOG, rankall, dmall, rôles, webhooks…) ;
//   • utiliser une commande à préfixe (+ban, =rank, ;mv…).
// Les quotas (8 commandes) sont en plus mis à 0 dans la base centrale (shared/freeze.js).
// L'owner n'est jamais gelé. L'état est relu dans la base centrale toutes les 15 s ;
// si elle est injoignable, le dernier état connu est gardé (un gel ne saute pas tout seul).
import { PermissionFlagsBits as P } from "discord.js";
import { getStaffFreeze } from "./shared/freeze.js";
import { MODERATION_TIERS, loadRoleTiers, ownerId } from "./shared/tiers.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";

export const FROZEN_CATEGORIES = Object.freeze(new Set(["SYS+", "Modération", "Administration & sécurité", "Administration", "Embeds & règlement", "Automatisation"]));
export const FROZEN_COMMANDS = Object.freeze(new Set([
  "dog", "dogall", "undog", "undogall", "malus", "menotte", "demenotte", "rankall", "dmall", "roletemp", "role", "roles", "webhook", "webhooks",
  "annonce", "pseudo", "staff", "staffhistory", "wakeup", "lockname", "waouf", "accessall", "mv", "blacklist", "quota", "sanction",
  "casier", "quarantaine", "antinuke", "automod", "bouclier", "maj", "pnd-add", "pnd-remove",
]));
// Toujours permis pendant un gel (pour pouvoir le constater ou le lever).
const ALWAYS_ALLOWED = new Set(["status", "aide", "help"]);

const cache = new Map(); // guildId → { until: number|null, at: number }
const REFRESH_MS = 15_000;

export function rememberFreeze(guildId, until) {
  cache.set(guildId, { until: until ?? null, at: Date.now() });
}

export function cachedFreezeUntil(guildId, now = Date.now()) {
  const until = cache.get(guildId)?.until ?? null;
  return until && until > now ? until : null;
}

export async function refreshFreeze(guildId) {
  try {
    const freeze = await getStaffFreeze(guildId);
    rememberFreeze(guildId, freeze?.until ?? null);
  } catch { /* base injoignable : on garde le dernier état connu */ }
  return cachedFreezeUntil(guildId);
}

export function startFreezeRefresh(guildIds) {
  const tick = () => { for (const id of guildIds()) void refreshFreeze(id); };
  tick();
  const timer = setInterval(tick, REFRESH_MS);
  timer.unref?.();
  return timer;
}

/** Pur : la commande est-elle bloquée par un gel ? */
export function commandFrozen({ commandName, category, prefixed = false }) {
  if (prefixed) return true;
  if (ALWAYS_ALLOWED.has(commandName)) return false;
  return FROZEN_COMMANDS.has(commandName) || FROZEN_CATEGORIES.has(category);
}

/** Membre du staff au sens du gel. */
export async function isStaffForFreeze(member, settings = null) {
  if (!member?.guild) return false;
  const perms = member.permissions;
  if (perms?.has?.(P.Administrator) || perms?.has?.(P.ManageGuild) || perms?.has?.(P.ManageRoles)) return true;
  const roles = member.roles?.cache;
  if (!roles) return false;
  const guildSettings = settings?.[member.guild.id] ?? {};
  const access = [guildSettings?.sysPlus?.roleId, guildSettings?.sysPlus?.whitelistRoleId, getAdminPlusRoleId(member.guild.id)].filter(Boolean);
  if (access.some((id) => roles.has(id))) return true;
  const tiers = await loadRoleTiers(member.guild.id).catch(() => new Map());
  return [...roles.keys()].some((id) => MODERATION_TIERS.includes(tiers.get(id)));
}

/**
 * Message de refus si le gel bloque cette commande pour ce membre, sinon null.
 * `member` doit être frais (rôles à jour).
 */
export async function freezeRefusal({ guildId, member, commandName = "", category = "", prefixed = false, settings = null, now = Date.now() }) {
  const until = cachedFreezeUntil(guildId, now);
  if (!until) return null;
  if (member?.id && member.id === ownerId()) return null;
  if (!commandFrozen({ commandName, category, prefixed })) return null;
  if (!(await isStaffForFreeze(member, settings))) return null;
  const t = Math.floor(until / 1000);
  return `🧊 Le staff est **gelé** par l'owner jusqu'à <t:${t}:t> (<t:${t}:R>). Les commandes du staff sont suspendues sur les 5 bots.`;
}

export function resetFreezeCacheForTests() { cache.clear(); }
