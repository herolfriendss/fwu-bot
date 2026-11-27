// GUARD — mode nuit planifié (/nuit).
//   Pendant la plage choisie (heure de Paris, par défaut 1 h → 7 h) : mode lent sur les salons choisis,
//   verrouillage en option (@everyone ne peut plus écrire), anti-raid renforcé (seuil d'arrivées abaissé).
//   À la fin de la plage, chaque salon retrouve exactement son état d'avant.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const NIGHT_COMMANDS = new Set(["nuit"]);
export const NIGHT_DEFAULTS = Object.freeze({ startHour: 1, endHour: 7, slowmode: 30, lock: false, raidThreshold: 4, maxChannels: 25 });

db.exec(`CREATE TABLE IF NOT EXISTS guard_night (
  guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, start_hour INTEGER NOT NULL DEFAULT 1, end_hour INTEGER NOT NULL DEFAULT 7,
  slowmode INTEGER NOT NULL DEFAULT 30, lock INTEGER NOT NULL DEFAULT 0, raid_threshold INTEGER NOT NULL DEFAULT 4,
  channels_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0, saved_json TEXT, updated_at INTEGER NOT NULL DEFAULT 0
)`);

export function nightConfig(guildId) {
  const row = db.prepare("SELECT * FROM guard_night WHERE guild_id=?").get(String(guildId));
  return {
    enabled: Boolean(row?.enabled), startHour: row?.start_hour ?? NIGHT_DEFAULTS.startHour, endHour: row?.end_hour ?? NIGHT_DEFAULTS.endHour,
    slowmode: row?.slowmode ?? NIGHT_DEFAULTS.slowmode, lock: Boolean(row?.lock ?? NIGHT_DEFAULTS.lock), raidThreshold: row?.raid_threshold ?? NIGHT_DEFAULTS.raidThreshold,
    channels: JSON.parse(row?.channels_json ?? "[]"), active: Boolean(row?.active), saved: row?.saved_json ? JSON.parse(row.saved_json) : null,
  };
}

function write(guildId, patch, now = Date.now()) {
  const next = { ...nightConfig(guildId), ...patch };
  db.prepare(`INSERT INTO guard_night(guild_id,enabled,start_hour,end_hour,slowmode,lock,raid_threshold,channels_json,active,saved_json,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, start_hour=excluded.start_hour, end_hour=excluded.end_hour,
    slowmode=excluded.slowmode, lock=excluded.lock, raid_threshold=excluded.raid_threshold, channels_json=excluded.channels_json, active=excluded.active,
    saved_json=excluded.saved_json, updated_at=excluded.updated_at`)
    .run(String(guildId), next.enabled ? 1 : 0, next.startHour, next.endHour, next.slowmode, next.lock ? 1 : 0, next.raidThreshold,
      JSON.stringify(next.channels), next.active ? 1 : 0, next.saved ? JSON.stringify(next.saved) : null, now);
  return nightConfig(guildId);
}

export function configureNight(guildId, { startHour, endHour, slowmode, lock, raidThreshold }) {
  const patch = {};
  if (startHour != null) { if (!(startHour >= 0 && startHour <= 23)) throw new Error("Heure de début : 0 à 23."); patch.startHour = startHour; }
  if (endHour != null) { if (!(endHour >= 0 && endHour <= 23)) throw new Error("Heure de fin : 0 à 23."); patch.endHour = endHour; }
  if (slowmode != null) { if (!(slowmode >= 0 && slowmode <= 21_600)) throw new Error("Mode lent : 0 à 21 600 secondes."); patch.slowmode = slowmode; }
  if (lock != null) patch.lock = Boolean(lock);
  if (raidThreshold != null) { if (!(raidThreshold >= 3 && raidThreshold <= 100)) throw new Error("Seuil anti-raid de nuit : 3 à 100 arrivées."); patch.raidThreshold = raidThreshold; }
  const next = { ...nightConfig(guildId), ...patch };
  if (next.startHour === next.endHour) throw new Error("Le début et la fin doivent être différents.");
  return write(guildId, patch);
}

export function setNightEnabled(guildId, enabled) { return write(guildId, { enabled: Boolean(enabled) }); }

export function addNightChannel(guildId, channelId) {
  const config = nightConfig(guildId);
  if (config.channels.includes(channelId)) return config;
  if (config.channels.length >= NIGHT_DEFAULTS.maxChannels) throw new Error(`${NIGHT_DEFAULTS.maxChannels} salons au plus.`);
  return write(guildId, { channels: [...config.channels, channelId] });
}

export function removeNightChannel(guildId, channelId) {
  const config = nightConfig(guildId);
  return write(guildId, { channels: config.channels.filter((id) => id !== channelId) });
}

/** Heure de Paris (0 à 23). */
export function parisHour(now = Date.now()) {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(now)).find((p) => p.type === "hour");
  return Number(part?.value ?? 0) % 24;
}

/** Dans la plage ? Gère le passage de minuit (23 h → 6 h). */
export function inNight(hour, startHour, endHour) {
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

/** Seuil anti-raid à appliquer maintenant (null hors de la nuit active). */
export function nightRaidThreshold(guildId) {
  const config = nightConfig(guildId);
  return config.enabled && config.active ? config.raidThreshold : null;
}

async function applyNight(guild, config) {
  const saved = {};
  for (const channelId of config.channels) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    const overwrite = channel.permissionOverwrites?.cache?.get?.(guild.roles.everyone.id);
    const send = overwrite?.deny?.has?.(P.SendMessages) ? false : overwrite?.allow?.has?.(P.SendMessages) ? true : null;
    saved[channelId] = { slowmode: channel.rateLimitPerUser ?? 0, send };
    if (typeof channel.setRateLimitPerUser === "function" && config.slowmode) await channel.setRateLimitPerUser(config.slowmode, "Mode nuit").catch(() => {});
    if (config.lock && channel.permissionOverwrites) await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: "Mode nuit" }).catch(() => {});
  }
  return saved;
}

async function restoreNight(guild, saved) {
  for (const [channelId, state] of Object.entries(saved ?? {})) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    if (typeof channel.setRateLimitPerUser === "function") await channel.setRateLimitPerUser(state.slowmode ?? 0, "Fin du mode nuit").catch(() => {});
    if (channel.permissionOverwrites) await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: state.send ?? null }, { reason: "Fin du mode nuit" }).catch(() => {});
  }
}

/**
 * Passage planifié (chaque minute). Rend "on", "off" ou null pour chaque serveur traité.
 * `notify(guild, text)` prévient le staff (logs).
 */
export async function runNightMode(client, { isAllowedGuild = () => true, now = Date.now(), notify = async () => {} } = {}) {
  const rows = db.prepare("SELECT guild_id FROM guard_night WHERE enabled=1 OR active=1").all();
  const hour = parisHour(now);
  const changes = {};
  for (const { guild_id: guildId } of rows) {
    const guild = isAllowedGuild(guildId) ? client.guilds.cache.get(guildId) : null;
    if (!guild) continue;
    const config = nightConfig(guildId);
    const night = config.enabled && inNight(hour, config.startHour, config.endHour);
    if (night && !config.active) {
      const saved = await applyNight(guild, config);
      write(guildId, { active: true, saved }, now);
      changes[guildId] = "on";
      await notify(guild, `🌙 Mode nuit activé (${config.startHour} h → ${config.endHour} h) : mode lent ${config.slowmode} s${config.lock ? ", salons verrouillés" : ""}, anti-raid à ${config.raidThreshold} arrivées, sur ${Object.keys(saved).length} salon(s).`).catch(() => {});
    } else if (!night && config.active) {
      await restoreNight(guild, config.saved);
      write(guildId, { active: false, saved: null }, now);
      changes[guildId] = "off";
      await notify(guild, "☀️ Mode nuit terminé : salons remis comme avant.").catch(() => {});
    }
  }
  return changes;
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

function stateText(config) {
  return [
    `🌙 **Mode nuit** : ${config.enabled ? "programmé" : "désactivé"}${config.active ? " · **en cours**" : ""}`,
    `Plage : ${config.startHour} h → ${config.endHour} h (heure de Paris)`,
    `Mode lent : ${config.slowmode} s · verrouillage : ${config.lock ? "oui" : "non"} · anti-raid de nuit : ${config.raidThreshold} arrivées`,
    `Salons : ${config.channels.length ? config.channels.map((id) => `<#${id}>`).join(", ") : "aucun (`/nuit salon-ajouter`)"}`,
  ].join("\n");
}

export async function handleNightInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "nuit" || !interaction.guild) return false;
  const gid = interaction.guild.id;
  const o = interaction.options;
  try {
    if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
    const sub = o.getSubcommand(false) ?? "etat";
    let config;
    if (sub === "configurer") config = configureNight(gid, { startHour: o.getInteger("debut", false), endHour: o.getInteger("fin", false), slowmode: o.getInteger("lent", false), lock: o.getBoolean("verrouiller", false), raidThreshold: o.getInteger("antiraid", false) });
    else if (sub === "activer") config = setNightEnabled(gid, true);
    else if (sub === "desactiver") config = setNightEnabled(gid, false);
    else if (sub === "salon-ajouter") config = addNightChannel(gid, o.getChannel("salon", true).id);
    else if (sub === "salon-retirer") config = removeNightChannel(gid, o.getChannel("salon", true).id);
    else config = nightConfig(gid);
    const hint = sub === "desactiver" && config.active ? "\nLes salons seront remis comme avant dans la minute." : "";
    await interaction.reply({ content: stateText(config) + hint, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
