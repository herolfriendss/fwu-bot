// FWU V2 — configuration des logs en base (serveur hub et serveurs sources).
//
// Remplace les identifiants codés en dur de logs-hub.js. Ordre de lecture :
//   1. la base partagée (réglée par /logs, OWNER seulement) ;
//   2. les variables d'environnement PND_LOGS_HUB_GUILD_ID / PND_LOG_SOURCE_GUILD_IDS ;
//   3. les valeurs historiques (LEGACY_LOGS_DEFAULTS), pour qu'une mise à jour ne perde
//      aucun log tant que /logs n'a pas été utilisé.
// Un serveur source = un jeu de salons. La source principale garde les noms historiques
// (« logs-sanctions »), les autres sont préfixées par leur slug (« mz-logs-sanctions »).
// MZ reste désactivé tant que sa configuration n'est pas validée (AGENTS.md).
import { db } from "./database.js";

export const LEGACY_LOGS_DEFAULTS = Object.freeze({
  hubGuildId: "1570484435239833701",
  sources: Object.freeze([
    Object.freeze({ guildId: "1562643485981544559", slug: "pnd", label: "Serveur principal", enabled: true, primary: true }),
    Object.freeze({ guildId: "1505904703563894814", slug: "mz", label: "MZ", enabled: false, primary: false }),
  ]),
});

const SNOWFLAKE = /^\d{17,20}$/;
const SLUG = /^[a-z][a-z0-9]{1,11}$/;

db.exec(`
  CREATE TABLE IF NOT EXISTS logs_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS log_sources (
    guild_id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS log_summary_deliveries (
    guild_id TEXT PRIMARY KEY,
    sent_at INTEGER NOT NULL
  );
`);

function readKey(key) {
  try {
    return db.prepare("SELECT value FROM logs_config WHERE key = ?").get(key)?.value ?? null;
  } catch {
    return null;
  }
}

function writeKey(key, value) {
  if (value === null || value === undefined || value === "") db.prepare("DELETE FROM logs_config WHERE key = ?").run(key);
  else db.prepare("INSERT INTO logs_config(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

/** Identifiant du serveur hub de logs. */
export function logsHubGuildId(env = process.env) {
  const stored = readKey("hub_guild_id");
  if (stored && SNOWFLAKE.test(stored)) return stored;
  const fromEnv = String(env.PND_LOGS_HUB_GUILD_ID ?? "").trim();
  if (SNOWFLAKE.test(fromEnv)) return fromEnv;
  return LEGACY_LOGS_DEFAULTS.hubGuildId;
}

function envSources(env) {
  const ids = String(env.PND_LOG_SOURCE_GUILD_IDS ?? "").split(",").map((v) => v.trim()).filter((v) => SNOWFLAKE.test(v));
  if (!ids.length) return null;
  const reserved = LEGACY_LOGS_DEFAULTS.sources.find((s) => s.slug === "mz");
  const list = ids.map((guildId, index) => ({ guildId, slug: index === 0 ? "pnd" : `src${index + 1}`, label: index === 0 ? "Serveur principal" : `Source ${index + 1}`, enabled: true, primary: index === 0 }));
  if (reserved && !ids.includes(reserved.guildId)) list.push({ ...reserved });
  return list;
}

/** Serveurs sources (activés ou réservés). */
export function logSources(env = process.env) {
  let rows = [];
  try {
    rows = db.prepare("SELECT guild_id, slug, label, enabled, is_primary FROM log_sources ORDER BY is_primary DESC, slug").all();
  } catch {
    rows = [];
  }
  if (rows.length) {
    return rows.map((row) => ({ guildId: row.guild_id, slug: row.slug, label: row.label, enabled: Boolean(row.enabled) && row.slug !== "mz", primary: Boolean(row.is_primary) }));
  }
  return (envSources(env) ?? LEGACY_LOGS_DEFAULTS.sources).map((source) => ({ ...source }));
}

export function activeSourceGuildIds(env = process.env) {
  return logSources(env).filter((source) => source.enabled).map((source) => source.guildId);
}

export function sourceForGuild(guildId, env = process.env) {
  return logSources(env).find((source) => source.guildId === guildId) ?? null;
}

/** Fige la configuration courante en base (première utilisation de /logs). */
function materialize(env = process.env) {
  const count = Number(db.prepare("SELECT COUNT(*) AS n FROM log_sources").get()?.n ?? 0);
  if (count) return;
  const insert = db.prepare("INSERT OR IGNORE INTO log_sources(guild_id, slug, label, enabled, is_primary) VALUES (?, ?, ?, ?, ?)");
  for (const source of logSources(env)) insert.run(source.guildId, source.slug, source.label, source.enabled ? 1 : 0, source.primary ? 1 : 0);
}

export function setLogsHub(guildId) {
  if (!SNOWFLAKE.test(String(guildId ?? ""))) throw new Error("Identifiant de serveur invalide.");
  if (logSources().some((source) => source.guildId === guildId)) throw new Error("Le hub ne peut pas être aussi un serveur source.");
  writeKey("hub_guild_id", guildId);
}

export function addLogSource({ guildId, slug, label }) {
  if (!SNOWFLAKE.test(String(guildId ?? ""))) throw new Error("Identifiant de serveur invalide.");
  const cleanSlug = String(slug ?? "").toLowerCase();
  if (!SLUG.test(cleanSlug)) throw new Error("Nom court invalide : 2 à 12 lettres ou chiffres, commençant par une lettre.");
  if (guildId === logsHubGuildId()) throw new Error("Le hub ne peut pas être un serveur source.");
  materialize();
  if (db.prepare("SELECT 1 FROM log_sources WHERE slug = ? AND guild_id <> ?").get(cleanSlug, guildId)) throw new Error("Ce nom court est déjà utilisé.");
  const primary = Number(db.prepare("SELECT COUNT(*) AS n FROM log_sources WHERE is_primary = 1").get()?.n ?? 0) === 0;
  db.prepare(`INSERT INTO log_sources(guild_id, slug, label, enabled, is_primary) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(guild_id) DO UPDATE SET slug = excluded.slug, label = excluded.label`)
    .run(guildId, cleanSlug, String(label ?? cleanSlug).slice(0, 60), primary ? 1 : 0);
}

/** Active ou désactive une source. MZ ne s'active pas ici (validation explicite requise). */
export function setLogSourceEnabled(guildId, enabled) {
  materialize();
  const row = db.prepare("SELECT slug FROM log_sources WHERE guild_id = ?").get(guildId);
  if (!row) throw new Error("Serveur source inconnu : ajoute-le d'abord.");
  if (enabled && row.slug === "mz") throw new Error("MZ reste désactivé tant que sa configuration n'a pas été validée.");
  db.prepare("UPDATE log_sources SET enabled = ? WHERE guild_id = ?").run(enabled ? 1 : 0, guildId);
}

export function removeLogSource(guildId) {
  materialize();
  db.prepare("DELETE FROM log_sources WHERE guild_id = ?").run(guildId);
}

/** Rôle du hub prévenu pour les alertes graves (staff de garde). */
export function alertRoleId() {
  const value = readKey("alert_role_id");
  return value && SNOWFLAKE.test(value) ? value : null;
}
export function setAlertRoleId(roleId) {
  if (roleId && !SNOWFLAKE.test(String(roleId))) throw new Error("Identifiant de rôle invalide.");
  writeKey("alert_role_id", roleId ?? null);
}

/** Durée de conservation de la copie en base des logs (jours, 7 à 730, 180 par défaut). */
export function logRetentionDays() {
  const value = Number(readKey("retention_days"));
  return Number.isInteger(value) && value >= 7 && value <= 730 ? value : 180;
}
export function setLogRetentionDays(days) {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 7 || value > 730) throw new Error("Conservation : entre 7 et 730 jours.");
  writeKey("retention_days", value);
}

/** Fréquence du résumé : "off", "daily" ou "weekly" (quotidien par défaut). */
export function logSummaryFrequency() {
  const value = readKey("summary_frequency");
  return ["off", "daily", "weekly"].includes(value) ? value : "daily";
}
export function setLogSummaryFrequency(value) {
  if (!["off", "daily", "weekly"].includes(value)) throw new Error("Fréquence : off, daily ou weekly.");
  writeKey("summary_frequency", value);
}

/** Last successful digest checkpoint; per-source checkpoints prevent duplicate sends on partial failures. */
export function lastSummaryAt(guildId = null) {
  if (guildId) {
    try {
      return Number(db.prepare("SELECT sent_at FROM log_summary_deliveries WHERE guild_id = ?").get(String(guildId))?.sent_at ?? 0) || 0;
    } catch {
      return 0;
    }
  }
  return Number(readKey("last_summary_at") ?? 0) || 0;
}
export function markSummarySent(at = Date.now(), guildId = null) {
  if (guildId) {
    db.prepare("INSERT INTO log_summary_deliveries(guild_id, sent_at) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET sent_at = excluded.sent_at")
      .run(String(guildId), Number(at));
    return;
  }
  writeKey("last_summary_at", at);
}
