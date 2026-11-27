// SYS+ — gel automatique du staff (idée 33). Opt-in (`/sysp auto-gel actif:true`) : quand l'anti-nuke de GUARD repousse
// une attaque (un compte du staff peut être piraté), le staff est gelé 30 min par défaut (commandes de pouvoir suspendues sur
// les 5 bots ; l'owner garde tout). Il ne retire aucun rôle, expire tout seul et se lève avec `/sysp degel`.
// Geler, c'est réduire les droits : jamais l'inverse. Pas de nouveau gel tant qu'un gel est en cours.
import { db } from "../../database.js";
import { setStaffFreeze, getStaffFreeze } from "../../shared/freeze.js";
import { rememberFreeze } from "../../staff-freeze-gate.js";
import { recordSysPlusAudit } from "./audit.js";

export const AUTO_FREEZE = Object.freeze({ defaultMinutes: 30, minMinutes: 5, maxMinutes: 240 });

db.exec("CREATE TABLE IF NOT EXISTS sysplus_auto_freeze (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, minutes INTEGER NOT NULL DEFAULT 30)");

export function autoFreezeConfig(guildId) {
  const row = db.prepare("SELECT * FROM sysplus_auto_freeze WHERE guild_id=?").get(guildId);
  return { enabled: Boolean(row?.enabled), minutes: Number(row?.minutes ?? AUTO_FREEZE.defaultMinutes) };
}

export function setAutoFreeze(guildId, { enabled, minutes = null }) {
  const current = autoFreezeConfig(guildId);
  const value = minutes === null || minutes === undefined ? current.minutes : Math.round(Number(minutes));
  if (!Number.isFinite(value) || value < AUTO_FREEZE.minMinutes || value > AUTO_FREEZE.maxMinutes) throw new Error(`Durée du gel automatique : de ${AUTO_FREEZE.minMinutes} à ${AUTO_FREEZE.maxMinutes} minutes.`);
  db.prepare("INSERT INTO sysplus_auto_freeze(guild_id,enabled,minutes) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, minutes=excluded.minutes").run(guildId, enabled ? 1 : 0, value);
  return autoFreezeConfig(guildId);
}

/** Appelé par l'anti-nuke après une attaque repoussée. Rend { frozen, until } ; ne lève jamais. */
export async function maybeAutoFreeze({ guildId, botId, bot, reason, setFreeze = setStaffFreeze, getFreeze = getStaffFreeze, remember = rememberFreeze }) {
  try {
    const config = autoFreezeConfig(guildId);
    if (!config.enabled) return { frozen: false, why: "off" };
    const existing = await getFreeze(guildId);
    if (existing) return { frozen: false, why: "already" };
    const freeze = await setFreeze({ guildId, seconds: config.minutes * 60, reason: `Gel automatique : ${reason}`.slice(0, 280), actorId: botId, bot });
    remember(guildId, freeze.until);
    try { recordSysPlusAudit(guildId, botId, "sysplus.member.auto_freeze", null, { minutes: config.minutes }); } catch { /* journal best effort */ }
    return { frozen: true, until: freeze.until, minutes: config.minutes };
  } catch {
    return { frozen: false, why: "error" };
  }
}
