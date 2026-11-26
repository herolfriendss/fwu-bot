// FWU V2 — journaux typés.
//
// Chaque log déclare `category` (un salon du hub), `action` (code stable), `severity`,
// l'acteur, la cible et, pour une sanction ou une action sensible, un numéro de dossier.
// Le routage se fait par catégorie ; le titre ne sert plus que de secours pour les
// anciens appels de sendCentralLog. Une copie de chaque log est gardée en base
// (`log_archive`) : un log supprimé dans Discord ne disparaît pas.
import { createHash } from "node:crypto";
import { db, transaction } from "./database.js";
import { sendCentralLog } from "./logs.js";
import { LOG_CATEGORY_KEYS } from "./logs-hub.js";
import { alertRoleId, logRetentionDays } from "./logs-config.js";

export const LOG_SEVERITIES = Object.freeze(["info", "notice", "warning", "critical"]);

/** Actions qui ouvrent un dossier (sanctions et actions sensibles). */
export const CASE_ACTIONS = Object.freeze(new Set([
  "ban", "unban", "kick", "tempmute", "unmute", "warn", "blacklist_add", "blacklist_remove",
  "quarantine_add", "quarantine_remove", "blr_set", "blr_lift", "sanction", "trap_caught",
  "dog", "menotte", "freeze", "antinuke_strip", "rank_revert",
]));

/** Événements graves : salon d'alertes + staff de garde, quelle que soit la gravité indiquée. */
export const ALERT_ACTIONS = Object.freeze(new Set([
  "raid", "raid_on", "blr_grant_attempt", "antinuke", "antinuke_strip", "permission_drift",
  "bot_added", "webhook_created", "token_leak", "repeated_errors", "mfa_not_required",
]));

const ACTION_LABELS = Object.freeze({
  ban: "Bannissement", unban: "Débannissement", kick: "Expulsion", tempmute: "Silence temporaire",
  unmute: "Fin du silence", warn: "Avertissement", blacklist_add: "Blacklist", blacklist_remove: "Fin de blacklist",
  quarantine_add: "Quarantaine", quarantine_remove: "Fin de quarantaine", blr_set: "BLR posé", blr_lift: "BLR levé",
  blr_grant_attempt: "Tentative de rang sur un BLR", raid: "Raid détecté", raid_on: "Mode raid", antinuke: "Anti-nuke",
  antinuke_strip: "Pouvoirs retirés (anti-nuke)", permission_drift: "Dérive de permissions", bot_added: "Bot ajouté",
  webhook_created: "Webhook créé", token_leak: "Token détecté", trap_caught: "Piège déclenché", sanction: "Sanction",
  repeated_errors: "Erreurs répétées", mfa_not_required: "Double authentification non exigée", rank_revert: "Rôle retiré (BLR)",
});

const SEVERITY_ICONS = Object.freeze({ info: "ℹ️", notice: "📝", warning: "⚠️", critical: "🚨" });
const BOT_TINTS = Object.freeze({ fwu: 0, guard: 1, fdpdlavoc: 2, suckme: 3, fisc: 4, investplus: 5 });
// Thème noir et blanc : la gravité se lit du blanc (info) au noir (critique), un léger écart par bot.
const SEVERITY_BASE = Object.freeze({ info: [0xe5e5e5, 0xe0e0e0, 0xdbdbdb, 0xd6d6d6, 0xd1d1d1, 0xcccccc], notice: [0xa3a3a3, 0x9e9e9e, 0x999999, 0x949494, 0x8f8f8f, 0x8a8a8a], warning: [0x666666, 0x616161, 0x5c5c5c, 0x575757, 0x525252, 0x4d4d4d], critical: [0x1a1a1a, 0x171717, 0x141414, 0x111111, 0x0e0e0e, 0x0b0b0b] });

export function severityColor(bot, severity) {
  const palette = SEVERITY_BASE[severity] ?? SEVERITY_BASE.info;
  return palette[BOT_TINTS[bot] ?? 0];
}

db.exec(`
  CREATE TABLE IF NOT EXISTS log_cases (
    guild_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    severity TEXT NOT NULL,
    actor_id TEXT,
    target_id TEXT,
    reason TEXT,
    details TEXT,
    bot TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, number)
  );
  CREATE TABLE IF NOT EXISTS log_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    category TEXT,
    action TEXT,
    severity TEXT,
    actor_id TEXT,
    target_id TEXT,
    case_number INTEGER,
    title TEXT,
    body TEXT,
    bot TEXT,
    dedup_key TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_log_archive_target ON log_archive(guild_id, target_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_log_archive_time ON log_archive(guild_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_log_archive_dedup ON log_archive(guild_id, dedup_key, created_at);
`);

const ID = /^\d{5,25}$/;
const clean = (value, max) => String(value ?? "").slice(0, max);

/** Valide et normalise un événement ; lève une Error lisible sinon. */
export function normalizeLogEvent(event = {}) {
  if (!LOG_CATEGORY_KEYS.includes(event.category)) throw new Error(`Catégorie de log inconnue : ${event.category ?? "(vide)"}.`);
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(String(event.action ?? ""))) throw new Error("Action de log manquante ou invalide.");
  if (!LOG_SEVERITIES.includes(event.severity)) throw new Error(`Gravité inconnue : ${event.severity ?? "(vide)"}.`);
  return {
    category: event.category,
    action: event.action,
    severity: event.severity,
    actorId: ID.test(String(event.actorId ?? "")) ? String(event.actorId) : null,
    targetId: ID.test(String(event.targetId ?? "")) ? String(event.targetId) : null,
    reason: event.reason ? clean(event.reason, 500) : null,
    details: event.details ? clean(event.details, 1500) : null,
    link: /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\//.test(String(event.link ?? "")) ? String(event.link) : null,
    title: event.title ? clean(event.title, 200) : null,
    bot: event.bot ?? null,
    caseNumber: Number.isInteger(event.caseNumber) ? event.caseNumber : null,
  };
}

export function actionLabel(action) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

/** Format unique : acteur, action, cible, dossier, lien ; couleur par bot et par gravité. */
export function buildLogEmbed(event) {
  const e = normalizeLogEvent(event);
  const fields = [
    { name: "Acteur", value: e.actorId ? `<@${e.actorId}>` : "Automatique", inline: true },
    { name: "Action", value: actionLabel(e.action), inline: true },
    { name: "Cible", value: e.targetId ? `<@${e.targetId}>` : "—", inline: true },
  ];
  if (e.caseNumber) fields.push({ name: "Dossier", value: `#${e.caseNumber}`, inline: true });
  if (e.link) fields.push({ name: "Lien", value: e.link, inline: true });
  if (e.reason) fields.push({ name: "Raison", value: e.reason, inline: false });
  return {
    color: severityColor(e.bot, e.severity),
    title: `${SEVERITY_ICONS[e.severity]} ${e.title ?? actionLabel(e.action)}`.slice(0, 256),
    ...(e.details ? { description: e.details } : {}),
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: `Journal typé • ${e.category} • ${e.action}` },
  };
}

/** Ouvre un dossier numéroté (numérotation propre à chaque serveur). */
export function openCase(guildId, event, now = Date.now()) {
  const e = normalizeLogEvent(event);
  return transaction(() => {
    const next = Number(db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM log_cases WHERE guild_id = ?").get(String(guildId))?.n ?? 1);
    db.prepare(`INSERT INTO log_cases(guild_id, number, category, action, severity, actor_id, target_id, reason, details, bot, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(String(guildId), next, e.category, e.action, e.severity, e.actorId, e.targetId, e.reason, e.details, e.bot, now);
    return next;
  });
}

export function getCase(guildId, number) {
  const row = db.prepare("SELECT * FROM log_cases WHERE guild_id = ? AND number = ?").get(String(guildId), Number(number));
  if (!row) return null;
  const logs = db.prepare("SELECT category, action, severity, title, created_at FROM log_archive WHERE guild_id = ? AND case_number = ? ORDER BY created_at").all(String(guildId), Number(number));
  return { number: row.number, category: row.category, action: row.action, severity: row.severity, actorId: row.actor_id, targetId: row.target_id, reason: row.reason, details: row.details, bot: row.bot, createdAt: row.created_at, logs };
}

function dedupKey(guildId, e) {
  return createHash("sha256").update([guildId, e.category, e.action, e.actorId, e.targetId, e.details, e.reason].join("|")).digest("hex").slice(0, 32);
}

const DEDUP_WINDOW_MS = 60_000;

function archive(guildId, { category, action, severity, actorId, targetId, caseNumber, title, body, bot, dedup }, now) {
  db.prepare(`INSERT INTO log_archive(guild_id, category, action, severity, actor_id, target_id, case_number, title, body, bot, dedup_key, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(String(guildId), category ?? null, action ?? null, severity ?? null, actorId ?? null, targetId ?? null, caseNumber ?? null, title ?? null, body ?? null, bot ?? null, dedup ?? null, now);
}

/** Copie en base d'un log non typé (anciens appels). La cible est la première mention. */
export function archiveRawLog(guildId, category, embed, now = Date.now()) {
  if (!guildId || !embed) return;
  const data = typeof embed.toJSON === "function" ? embed.toJSON() : embed;
  const text = [data.description ?? "", ...(data.fields ?? []).map((f) => `${f.name}: ${f.value}`)].join("\n");
  const mention = text.match(/<@!?(\d{17,20})>/);
  archive(guildId, { category, action: null, severity: null, targetId: mention?.[1] ?? null, title: clean(data.title, 200), body: clean(text, 4000) }, now);
}

/**
 * Journalise un événement typé : dossier si besoin, déduplication, copie en base,
 * envoi par catégorie (alertes graves → salon d'alertes + rôle de garde).
 * Retourne { caseNumber, delivered, duplicate }.
 */
export async function logEvent(guild, settings, event, { send = sendCentralLog, now = Date.now() } = {}) {
  if (!guild?.id) return { caseNumber: null, delivered: false, duplicate: false };
  const e = normalizeLogEvent(event);
  const key = dedupKey(guild.id, e);
  const recent = db.prepare("SELECT 1 FROM log_archive WHERE guild_id = ? AND dedup_key = ? AND created_at > ? AND created_at <= ? LIMIT 1").get(String(guild.id), key, now - DEDUP_WINDOW_MS, now);
  if (recent) return { caseNumber: null, delivered: false, duplicate: true };
  const caseNumber = e.caseNumber ?? (CASE_ACTIONS.has(e.action) ? openCase(guild.id, e, now) : null);
  const alert = e.severity === "critical" || ALERT_ACTIONS.has(e.action);
  const category = alert ? "alerts" : e.category;
  const embed = buildLogEmbed({ ...e, caseNumber });
  archive(guild.id, { ...e, category: e.category, caseNumber, title: embed.title, body: clean([e.details, e.reason].filter(Boolean).join("\n"), 4000), dedup: key }, now);
  const role = alert ? alertRoleId() : null;
  const users = [e.actorId, e.targetId].filter(Boolean);
  let delivered = false;
  try {
    delivered = Boolean(await send(guild, settings, embed, [], [], users, { category, archived: true, mentionRoleIds: role ? [role] : [] }));
  } catch {
    delivered = false;
  }
  return { caseNumber, delivered, duplicate: false };
}

/** Recherche (membre, type d'action, catégorie, période), plus récent d'abord. */
export function searchLogs({ guildId, memberId = null, action = null, category = null, since = null, until = null, limit = 25 } = {}) {
  const where = ["guild_id = ?"];
  const args = [String(guildId)];
  if (memberId) { where.push("(target_id = ? OR actor_id = ?)"); args.push(String(memberId), String(memberId)); }
  if (action) { where.push("action = ?"); args.push(String(action)); }
  if (category) { where.push("category = ?"); args.push(String(category)); }
  if (since !== null) { where.push("created_at >= ?"); args.push(Number(since)); }
  if (until !== null) { where.push("created_at <= ?"); args.push(Number(until)); }
  const max = Math.min(100, Math.max(1, Number(limit) || 25));
  return db.prepare(`SELECT id, category, action, severity, actor_id AS actorId, target_id AS targetId, case_number AS caseNumber, title, created_at AS createdAt
    FROM log_archive WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${max}`).all(...args);
}

/** Chronologie d'un membre (ce qu'il a subi et ce qu'il a fait). */
export function memberTimeline(guildId, memberId, limit = 25) {
  return searchLogs({ guildId, memberId, limit });
}

/** Supprime les copies plus vieilles que la conservation réglée. */
export function pruneLogArchive(now = Date.now(), days = logRetentionDays()) {
  const result = db.prepare("DELETE FROM log_archive WHERE created_at < ?").run(now - days * 86_400_000);
  return Number(result?.changes ?? 0);
}

/** Résumé d'une période : nombre de logs par catégorie et par gravité, dossiers ouverts. */
export function buildLogSummary(guildId, since, until = Date.now()) {
  const byCategory = db.prepare("SELECT COALESCE(category, '—') AS category, COUNT(*) AS n FROM log_archive WHERE guild_id = ? AND created_at BETWEEN ? AND ? GROUP BY category ORDER BY n DESC").all(String(guildId), since, until);
  const bySeverity = db.prepare("SELECT severity, COUNT(*) AS n FROM log_archive WHERE guild_id = ? AND severity IS NOT NULL AND created_at BETWEEN ? AND ? GROUP BY severity").all(String(guildId), since, until);
  const cases = Number(db.prepare("SELECT COUNT(*) AS n FROM log_cases WHERE guild_id = ? AND created_at BETWEEN ? AND ?").get(String(guildId), since, until)?.n ?? 0);
  const total = byCategory.reduce((sum, row) => sum + Number(row.n), 0);
  return {
    color: 0x5865f2,
    title: "🗞️ Résumé des journaux",
    description: total
      ? `${total} événement(s) du <t:${Math.floor(since / 1000)}:f> au <t:${Math.floor(until / 1000)}:f>.\n${byCategory.map((row) => `• ${row.category} : ${row.n}`).join("\n")}`
      : "Aucun événement sur la période.",
    fields: [
      { name: "Dossiers ouverts", value: String(cases), inline: true },
      ...bySeverity.map((row) => ({ name: `${SEVERITY_ICONS[row.severity] ?? ""} ${row.severity}`, value: String(row.n), inline: true })),
    ],
    timestamp: new Date(until).toISOString(),
  };
}

/**
 * Maintenance (bot principal) : purge selon la conservation, résumé quotidien ou
 * hebdomadaire vers chaque serveur source actif (salon « bot » du hub).
 */
export function startLogMaintenance({ client, record = () => {}, sources = () => [], intervalMs = 60 * 60_000 }) {
  const tick = async () => {
    try { pruneLogArchive(); } catch { record("log_retention_error"); }
    try {
      const { logSummaryFrequency, lastSummaryAt, markSummarySent } = await import("./logs-config.js");
      const frequency = logSummaryFrequency();
      if (frequency === "off") return;
      const period = frequency === "weekly" ? 7 * 86_400_000 : 86_400_000;
      const now = Date.now();
      const last = lastSummaryAt();
      if (last && now - last < period) return;
      markSummarySent(now);
      for (const guildId of sources()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        await sendCentralLog(guild, null, buildLogSummary(guildId, last || now - period, now), [], [], [], { category: "system", archived: true }).catch(() => record("log_summary_error"));
      }
    } catch {
      record("log_summary_error");
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
