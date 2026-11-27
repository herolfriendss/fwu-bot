// GUARD — surveillances ajoutées le 27/11 :
//  • un compte récent qui arrive avec le pseudo ou l'avatar d'un banni (contournement de ban) ;
//  • l'AutoMod natif bloque un lien de phishing → l'auteur part en quarantaine ;
//  • une intégration (bot, application) ajoutée au serveur ;
//  • le bot perd une permission dont il a besoin.
// Chaque fonction de décision est pure ; les gestionnaires ne font qu'alerter ou mettre en quarantaine.
import { PermissionFlagsBits as P } from "discord.js";
import { NATIVE_RULE_PREFIX } from "./native-automod.js";

export const EVADER_ACCOUNT_DAYS = 30;
const normalize = (name) => String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Does this newcomer look like a banned user? Returns the matching ban or null. */
export function matchBanEvader(member, bans, { now = Date.now() } = {}) {
  const user = member?.user;
  if (!user || user.bot) return null;
  if (now - Number(user.createdTimestamp ?? 0) > EVADER_ACCOUNT_DAYS * 86_400_000) return null;
  const names = new Set([user.username, user.globalName, member.displayName].map(normalize).filter((n) => n.length >= 4));
  for (const ban of bans) {
    const banned = ban.user ?? ban;
    if (!banned || banned.id === user.id) continue;
    if (user.avatar && banned.avatar && user.avatar === banned.avatar) return { ban: banned, reason: "même avatar" };
    for (const n of [banned.username, banned.globalName].map(normalize)) if (n.length >= 4 && names.has(n)) return { ban: banned, reason: "même pseudo" };
  }
  return null;
}

/** Is this AutoMod execution our native phishing rule? */
export function isPhishingExecution(execution, ruleName) {
  return Boolean(execution?.userId) && String(ruleName ?? "") === `${NATIVE_RULE_PREFIX}phishing et faux Nitro`;
}

/** Permissions a bot needs to protect the server; missing ones are reported. */
export const REQUIRED_PERMISSIONS = Object.freeze({
  guard: ["BanMembers", "KickMembers", "ModerateMembers", "ManageRoles", "ManageChannels", "ManageMessages", "ViewAuditLog", "ManageGuild"],
  suckme: ["ManageRoles", "ManageNicknames", "MuteMembers", "MoveMembers", "ManageMessages"],
  fwu: ["ManageRoles", "ManageMessages", "ViewAuditLog", "SendMessages", "EmbedLinks"],
  fdpdlavoc: ["MoveMembers", "MuteMembers", "ManageChannels", "Connect", "Speak"],
  fisc: ["SendMessages", "EmbedLinks"],
  investplus: ["SendMessages", "EmbedLinks"],
});
export function missingPermissions(permissions, profile) {
  const needed = REQUIRED_PERMISSIONS[profile] ?? REQUIRED_PERMISSIONS.fwu;
  if (permissions?.has?.(P.Administrator)) return [];
  return needed.filter((name) => !permissions?.has?.(P[name]));
}

const PERMISSION_FR = {
  BanMembers: "Bannir", KickMembers: "Expulser", ModerateMembers: "Exclure temporairement", ManageRoles: "Gérer les rôles",
  ManageChannels: "Gérer les salons", ManageMessages: "Gérer les messages", ViewAuditLog: "Voir les logs du serveur", ManageGuild: "Gérer le serveur",
  ManageNicknames: "Gérer les pseudos", MuteMembers: "Rendre muet", MoveMembers: "Déplacer des membres", SendMessages: "Envoyer des messages",
  EmbedLinks: "Intégrer des liens", Connect: "Se connecter", Speak: "Parler",
};
export const permissionLabel = (name) => PERMISSION_FR[name] ?? name;

/** Tracks the last missing set per guild so only changes raise an alert. */
export function createPermissionWatch() {
  const last = new Map();
  return {
    check(guildId, missing) {
      const key = [...missing].sort().join(",");
      const previous = last.get(guildId);
      last.set(guildId, key);
      if (previous === undefined) return missing.length ? { lost: missing, regained: [] } : null;
      if (previous === key) return null;
      const before = new Set(previous ? previous.split(",") : []);
      const now = new Set(missing);
      return { lost: missing.filter((m) => !before.has(m)), regained: [...before].filter((m) => !now.has(m)) };
    },
  };
}

// ── Ban list cache (refreshed at most every 30 min per guild) ──
const banCache = new Map();
export async function cachedBans(guild, { now = Date.now(), ttlMs = 30 * 60_000 } = {}) {
  const hit = banCache.get(guild.id);
  if (hit && now - hit.at < ttlMs) return hit.bans;
  const fetched = await guild.bans.fetch({ limit: 1000 }).catch(() => null);
  const bans = fetched ? [...fetched.values()].map((b) => b.user) : (hit?.bans ?? []);
  banCache.set(guild.id, { at: now, bans });
  return bans;
}
