// Statut riche (rich presence) de chaque bot : une activité qui tourne toutes
// les minutes, avec des compteurs à jour ({membres}, {serveurs}, {vocal}…).
//
// Réglable sans toucher au code, dans le même fichier que les préfixes
// (PND_DATA_DIR/bots.json, jamais écrasé par une mise à jour) :
//   "presence": {
//     "guard": { "status": "dnd", "interval": 90, "activities": [{ "type": "watching", "text": "{membres} membres" }] }
//   }
// Un profil absent du fichier garde ses statuts par défaut ci-dessous.
import { existsSync, readFileSync } from "node:fs";
import { ActivityType } from "discord.js";
import { botsConfigPath } from "./bot-runtime.js";

export const PRESENCE_TYPES = Object.freeze({
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
});
export const PRESENCE_STATUSES = Object.freeze(["online", "idle", "dnd"]);
export const PRESENCE_MIN_INTERVAL_S = 30;
export const PRESENCE_MAX_ACTIVITIES = 10;
export const PRESENCE_MAX_TEXT = 120;
const PLACEHOLDERS = ["membres", "serveurs", "vocal", "prefixe", "bot"];

const a = (type, text) => ({ type, text });
/** Statuts par défaut, un jeu par bot (Invest + compris, pour quand il arrive). */
export const DEFAULT_PRESENCES = Object.freeze({
  fwu: { status: "online", interval: 60, activities: [
    a("watching", "{membres} membres"), a("custom", "🛡️ Modération du staff · /aide"), a("listening", "les signalements"),
  ] },
  guard: { status: "dnd", interval: 60, activities: [
    a("watching", "{serveurs} serveur(s) sous protection"), a("custom", "🔒 Anti-nuke actif · {prefixe}aide"), a("competing", "la chasse aux raids"),
  ] },
  fdpdlavoc: { status: "online", interval: 60, activities: [
    a("listening", "{vocal} membre(s) en vocal"), a("custom", "🎶 Musique et vocaux · {prefixe}play"), a("playing", "la radio 24h/24"),
  ] },
  suckme: { status: "online", interval: 60, activities: [
    a("watching", "{membres} membres"), a("custom", "✨ SYS+, tickets et animations · {prefixe}aide"), a("playing", "à la question du jour"),
  ] },
  fisc: { status: "idle", interval: 60, activities: [
    a("watching", "les comptes de {membres} membres"), a("custom", "💸 Économie et casino · {prefixe}daily"), a("playing", "au morpion · /jeu"),
  ] },
  investplus: { status: "online", interval: 60, activities: [
    a("watching", "les abonnements"), a("custom", "📈 Invest + · {prefixe}abonnement"),
  ] },
});
const GENERIC = { status: "online", interval: 60, activities: [a("watching", "{membres} membres"), a("custom", "{bot} · /aide")] };

/** Pur : valide le réglage d'un profil (erreur claire, sinon le bot garde les défauts). */
export function validatePresence(raw) {
  if (!raw || typeof raw !== "object") throw new Error("réglage de statut invalide");
  const status = raw.status ?? "online";
  if (!PRESENCE_STATUSES.includes(status)) throw new Error(`statut inconnu « ${status} » (online, idle ou dnd)`);
  const interval = Math.trunc(Number(raw.interval ?? 60));
  if (!Number.isFinite(interval) || interval < PRESENCE_MIN_INTERVAL_S) throw new Error(`intervalle trop court (${PRESENCE_MIN_INTERVAL_S} s minimum)`);
  const list = Array.isArray(raw.activities) ? raw.activities : [];
  if (!list.length || list.length > PRESENCE_MAX_ACTIVITIES) throw new Error(`entre 1 et ${PRESENCE_MAX_ACTIVITIES} activités`);
  const activities = list.map((item) => {
    if (!item || !Object.hasOwn(PRESENCE_TYPES, item.type)) throw new Error(`type d'activité inconnu « ${item?.type} »`);
    const text = String(item.text ?? "").trim();
    if (!text || text.length > PRESENCE_MAX_TEXT) throw new Error(`texte d'activité vide ou trop long (${PRESENCE_MAX_TEXT} caractères)`);
    for (const match of text.matchAll(/\{([a-z]+)\}/g)) {
      if (!PLACEHOLDERS.includes(match[1])) throw new Error(`variable inconnue {${match[1]}} (${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")})`);
    }
    return { type: item.type, text };
  });
  return { status, interval, activities };
}

/**
 * Réglage du profil : bots.json s'il en définit un valide, sinon les défauts.
 * Un réglage invalide ne bloque jamais le démarrage : il est signalé et ignoré.
 */
export function loadPresence(profile, { env = process.env, warn = () => {} } = {}) {
  const fallback = DEFAULT_PRESENCES[profile] ?? GENERIC;
  const path = botsConfigPath(env);
  if (!existsSync(path)) return fallback;
  try {
    const custom = JSON.parse(readFileSync(path, "utf8"))?.presence?.[profile];
    return custom ? validatePresence(custom) : fallback;
  } catch (error) {
    warn(`Statut riche ignoré (${path}) : ${error instanceof Error ? error.message : "réglage invalide"}.`);
    return fallback;
  }
}

/** Pur : compteurs affichés, calculés depuis le cache Discord (aucun appel réseau). */
export function presenceStats(guilds) {
  let members = 0;
  let voice = 0;
  let servers = 0;
  for (const guild of guilds) {
    servers++;
    members += Number(guild.memberCount ?? 0);
    voice += Number(guild.voiceStates?.cache?.filter?.((s) => s.channelId && !s.member?.user?.bot)?.size ?? 0);
  }
  return { membres: members, serveurs: servers, vocal: voice };
}

/** Pur : remplace les variables. Les nombres sont écrits à la française (1 234). */
export function renderPresenceText(text, values) {
  return String(text).replace(/\{([a-z]+)\}/g, (all, key) => {
    const value = values[key];
    if (value === undefined || value === null) return all;
    return typeof value === "number" ? value.toLocaleString("fr-FR") : String(value);
  }).slice(0, 128);
}

/** Pur : la présence à afficher au tour `tick`. */
export function presenceAt(config, tick, values) {
  const activity = config.activities[((tick % config.activities.length) + config.activities.length) % config.activities.length];
  const text = renderPresenceText(activity.text, values);
  const entry = activity.type === "custom"
    ? { name: "Statut", state: text, type: PRESENCE_TYPES.custom }
    : { name: text, type: PRESENCE_TYPES[activity.type] };
  return { status: config.status, activities: [entry] };
}

/**
 * Lance la rotation. `guilds()` donne les serveurs à compter (Logs Hub exclu).
 * Renvoie une fonction d'arrêt.
 */
export function startPresence(client, { profile, label, prefix, guilds, env = process.env, warn = console.warn, onError = () => {} }) {
  const config = loadPresence(profile, { env, warn });
  let tick = 0;
  const apply = () => {
    try {
      const values = { ...presenceStats(guilds()), prefixe: prefix ?? "/", bot: label };
      client.user?.setPresence(presenceAt(config, tick++, values));
    } catch { onError(); }
  };
  apply();
  const timer = setInterval(apply, config.interval * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
