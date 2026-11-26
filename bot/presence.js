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
import { db } from "./database.js";

// V2 : statut changé sans toucher aux fichiers (/presence, table partagée par les 6 bots).
db.exec(`CREATE TABLE IF NOT EXISTS presence_overrides (
  profile TEXT PRIMARY KEY, type TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER, set_by TEXT, updated_at INTEGER NOT NULL
)`);

export function setPresenceOverride(profile, { type, text, status = "online", durationMs = null, setBy = null }, now = Date.now()) {
  const [checked] = validatePresence({ status, interval: 60, activities: [{ type, text }] }).activities;
  db.prepare(`INSERT INTO presence_overrides(profile, type, text, status, expires_at, set_by, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(profile) DO UPDATE SET type = excluded.type, text = excluded.text, status = excluded.status, expires_at = excluded.expires_at, set_by = excluded.set_by, updated_at = excluded.updated_at`)
    .run(profile, checked.type, checked.text, status, durationMs ? now + durationMs : null, setBy, now);
}
export function clearPresenceOverride(profile) {
  db.prepare("DELETE FROM presence_overrides WHERE profile = ?").run(profile);
}
export function presenceOverride(profile, now = Date.now()) {
  const row = db.prepare("SELECT * FROM presence_overrides WHERE profile = ?").get(profile);
  if (!row || (row.expires_at && row.expires_at <= now)) return null;
  return { type: row.type, text: row.text, status: row.status };
}

/** Statuts saisonniers (ajoutés à la rotation pendant la période). */
export function seasonalActivity(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 12 && d >= 1 && d <= 31) return { type: "custom", text: d >= 24 && d <= 26 ? "🎄 Joyeux Noël !" : "❄️ Bonnes fêtes de fin d'année" };
  if (m === 1 && d <= 7) return { type: "custom", text: "🎆 Bonne année !" };
  if (m === 2 && d === 14) return { type: "custom", text: "💘 Joyeuse Saint-Valentin" };
  if (m === 10 && d >= 25) return { type: "custom", text: "🎃 Joyeux Halloween" };
  if (m === 6 && d === 21) return { type: "custom", text: "🎶 Fête de la musique" };
  return null;
}

/**
 * Pur : statut imposé par un événement, du plus prioritaire au moins prioritaire :
 * maintenance, statut posé par /presence, mode raid (GUARD), musique en cours (FDPDLAVOC),
 * cagnotte (LE FISC). Discord n'affiche qu'un texte, un type d'activité et un statut.
 */
export function eventPresence(profile, { maintenance = null, override = null, raidActive = false, nowPlaying = null, jackpot = null } = {}) {
  if (maintenance) return { status: "idle", activity: { type: "custom", text: `🛠️ Maintenance${maintenance === true ? "" : ` : ${String(maintenance).slice(0, 80)}`}` } };
  if (override) return { status: override.status, activity: { type: override.type, text: override.text } };
  if (profile === "guard" && raidActive) return { status: "dnd", activity: { type: "custom", text: "🚨 Mode raid" } };
  if (profile === "fdpdlavoc" && nowPlaying) return { status: "online", activity: { type: "listening", text: nowPlaying } };
  if (profile === "fisc" && Number(jackpot) > 0) return { status: "idle", activity: { type: "custom", text: `💰 Cagnotte : ${Number(jackpot).toLocaleString("fr-FR")}` } };
  return null;
}

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
export function startPresence(client, { profile, label, prefix, guilds, env = process.env, warn = console.warn, onError = () => {}, events = () => ({}) }) {
  const config = loadPresence(profile, { env, warn });
  const startedAt = Date.now();
  const apply = () => {
    try {
      // La rotation garde son rythme (intervalle réglé) même si le contrôle est plus fréquent.
      const tick = Math.floor((Date.now() - startedAt) / (config.interval * 1000));
      const values = { ...presenceStats(guilds()), prefixe: prefix ?? "/", bot: label };
      const forced = eventPresence(profile, { ...events(), override: presenceOverride(profile) });
      if (forced) {
        client.user?.setPresence(presenceAt({ status: forced.status, activities: [forced.activity] }, 0, values));
        return;
      }
      const seasonal = seasonalActivity();
      const rotation = seasonal ? { ...config, activities: [...config.activities, seasonal] } : config;
      client.user?.setPresence(presenceAt(rotation, tick, values));
    } catch { onError(); }
  };
  apply();
  // Les événements (raid, musique) sont vus en moins de 30 s, quel que soit l'intervalle de rotation.
  const timer = setInterval(apply, Math.min(config.interval, 30) * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ---- description du bot (texte « À propos » de l'application) ----
db.exec(`CREATE TABLE IF NOT EXISTS presence_descriptions (profile TEXT PRIMARY KEY, text TEXT NOT NULL, applied_text TEXT, updated_at INTEGER NOT NULL)`);

export function setBotDescription(profile, text, now = Date.now()) {
  const clean = String(text ?? "").trim().slice(0, 400);
  if (!clean) throw new Error("Description vide.");
  db.prepare(`INSERT INTO presence_descriptions(profile, text, applied_text, updated_at) VALUES (?, ?, NULL, ?)
    ON CONFLICT(profile) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(profile, clean, now);
}

/** Chaque bot applique lui-même sa description (seul son propre jeton le permet). */
export async function applyBotDescription(client, profile) {
  const row = db.prepare("SELECT text, applied_text FROM presence_descriptions WHERE profile = ?").get(profile);
  if (!row || row.text === row.applied_text || !client?.application?.edit) return false;
  await client.application.edit({ description: row.text });
  db.prepare("UPDATE presence_descriptions SET applied_text = ? WHERE profile = ?").run(row.text, profile);
  return true;
}

const PROFILE_CHOICES = ["fwu", "guard", "fdpdlavoc", "suckme", "fisc", "investplus"];

/** /presence et =presence : OWNER ou Administrateur. */
export async function runPresenceCommand({ member, sub, bot, type = "custom", text = null, status = "online", duration = null }, { env = process.env } = {}) {
  const owner = String(env.PND_OWNER_DISCORD_ID ?? "").trim();
  const allowed = member?.id === owner || member?.id === member?.guild?.ownerId || member?.permissions?.has?.(8n);
  if (!allowed) return "⛔ Réservé à l'OWNER et aux administrateurs.";
  if (!PROFILE_CHOICES.includes(bot)) return `⚠️ Bot inconnu : ${PROFILE_CHOICES.join(", ")}.`;
  try {
    if (sub === "retirer") { clearPresenceOverride(bot); return "✅ Statut automatique rétabli."; }
    if (sub === "description") { setBotDescription(bot, text); return "✅ Description enregistrée : le bot l'applique dans la minute."; }
    const match = String(duration ?? "").match(/^(\d{1,4})\s*(m|min|h|j)$/i);
    const durationMs = match ? Number(match[1]) * (/^h$/i.test(match[2]) ? 3_600_000 : /^j$/i.test(match[2]) ? 86_400_000 : 60_000) : null;
    setPresenceOverride(bot, { type, text, status, durationMs, setBy: member.id });
    return `✅ Statut défini${durationMs ? ` pour ${duration}` : ""}. Discord n'affiche qu'un texte, un type d'activité et un statut (pas d'image ni de bouton).`;
  } catch (error) {
    return `❌ ${error?.message ?? "Statut invalide."}`;
  }
}

export async function handlePresenceInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "presence") return false;
  const o = interaction.options;
  const content = await runPresenceCommand({ member: interaction.member, sub: o.getSubcommand(), bot: o.getString("bot", true), type: o.getString("type", false) ?? "custom", text: o.getString("texte", false), status: o.getString("statut", false) ?? "online", duration: o.getString("duree", false) });
  await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  return true;
}
