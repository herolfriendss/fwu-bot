// STAFF CENTER (SUCK ME) — missions et objectifs, réunions et comptes rendus (tâche 1.4).
//
// /staff mission creer · liste · terminer · annuler
// /staff reunion planifier · liste · compte-rendu · annuler
//
// Règles : missions créées par les SYS+ / l'OWNER, individuelles (un membre du staff) ou
// collectives (tout le staff) ; une mission ne donne ni rôle ni récompense automatique ;
// réunions avec rappel 30 min avant dans le salon où elles ont été planifiées (heure stockée,
// fiable après redémarrage) ; données isolées par serveur ; aucune mention de masse.
import { db as defaultDb } from "./database.js";
import { cleanText } from "./staff-interventions.js";
import { TIME_ZONE } from "./staff-availability.js";

export const MEETING_REMINDER_MS = 30 * 60_000;
const MAX_AHEAD_MS = 90 * 86_400_000;

export function ensureMissionTables(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, number INTEGER NOT NULL,
      title TEXT NOT NULL, assignee_id TEXT, created_by TEXT NOT NULL, due_at INTEGER,
      status TEXT NOT NULL DEFAULT 'open', report TEXT, done_by TEXT,
      created_at INTEGER NOT NULL, closed_at INTEGER, UNIQUE (guild_id, number)
    );
    CREATE TABLE IF NOT EXISTS staff_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, number INTEGER NOT NULL,
      topic TEXT NOT NULL, channel_id TEXT NOT NULL, starts_at INTEGER NOT NULL, created_by TEXT NOT NULL,
      reminded INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0,
      minutes TEXT, minutes_by TEXT, created_at INTEGER NOT NULL, UNIQUE (guild_id, number)
    );
    CREATE INDEX IF NOT EXISTS staff_meetings_due ON staff_meetings(reminded, cancelled, starts_at);
  `);
}

const nextNumber = (db, table, guildId) => Number(db.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM ${table} WHERE guild_id = ?`).get(String(guildId)).n);

/** Offset in ms between UTC and Paris at a given instant (handles summer time). */
function parisOffsetMs(at) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - Math.floor(at / 60_000) * 60_000;
}

/**
 * "28/11 21h", "28/11/2026 21:30", "demain 20h", "aujourd'hui 18h" (heure de Paris) → epoch ms.
 * Refuses the past and more than 90 days ahead.
 */
export function parseParisDate(input, now = Date.now()) {
  const text = String(input ?? "").trim().toLowerCase();
  let day; let month; let year; let rest;
  const rel = text.match(/^(aujourd'hui|aujourd’hui|demain)\s+(.+)$/);
  const abs = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(.+)$/);
  const paris = new Date(now + parisOffsetMs(now));
  if (rel) {
    const base = new Date(Date.UTC(paris.getUTCFullYear(), paris.getUTCMonth(), paris.getUTCDate() + (rel[1] === "demain" ? 1 : 0)));
    day = base.getUTCDate(); month = base.getUTCMonth() + 1; year = base.getUTCFullYear(); rest = rel[2];
  } else if (abs) {
    day = Number(abs[1]); month = Number(abs[2]); year = abs[3] ? Number(abs[3]) : paris.getUTCFullYear(); rest = abs[4];
  } else return { error: "Date illisible. Exemples : « 28/11 21h », « demain 20h30 »." };
  const time = rest.match(/^(\d{1,2})(?:h|:)(\d{2})?$/) ?? rest.match(/^(\d{1,2})$/);
  if (!time) return { error: "Heure illisible. Exemples : 21h, 20h30, 18:45." };
  const hour = Number(time[1]); const minute = Number(time[2] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return { error: "Date ou heure impossible." };
  let local = Date.UTC(year, month - 1, day, hour, minute);
  // Without a year, a date already past this year means next year (e.g. 02/01 written in December).
  if (!abs?.[3] && !rel && local - parisOffsetMs(local) < now - 86_400_000) local = Date.UTC(year + 1, month - 1, day, hour, minute);
  const check = new Date(local);
  if (check.getUTCDate() !== day) return { error: "Cette date n'existe pas." };
  const at = local - parisOffsetMs(local);
  if (at <= now) return { error: "Cette date est déjà passée." };
  if (at - now > MAX_AHEAD_MS) return { error: "Au plus 90 jours à l'avance." };
  return { at };
}

// ------------------------------------------------------------------ missions
export function createMission({ guildId, actorId, title, assigneeId = null, dueAt = null }, { db = defaultDb, now = Date.now() } = {}) {
  ensureMissionTables(db);
  const clean = cleanText(title, 150);
  if (!clean) return { error: "Décris la mission." };
  const number = nextNumber(db, "staff_missions", guildId);
  db.prepare("INSERT INTO staff_missions(guild_id, number, title, assignee_id, created_by, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(String(guildId), number, clean, assigneeId, actorId, dueAt, now);
  return { number };
}

/** Open missions visible to `userId`: their own, the collective ones, or all for a manager. */
export function listMissions(guildId, { userId = null, all = false, status = "open", db = defaultDb, limit = 15 } = {}) {
  ensureMissionTables(db);
  const rows = db.prepare(`SELECT number, title, assignee_id, due_at, status, report FROM staff_missions WHERE guild_id = ? AND status = ?
    ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, number LIMIT 100`).all(String(guildId), status);
  return rows.filter((r) => all || r.assignee_id === null || r.assignee_id === userId).slice(0, limit);
}

export function finishMission({ guildId, number, actorId, report, canManage = false, cancel = false }, { db = defaultDb, now = Date.now() } = {}) {
  ensureMissionTables(db);
  const row = db.prepare("SELECT * FROM staff_missions WHERE guild_id = ? AND number = ?").get(String(guildId), Number(number));
  if (!row) return { error: `Mission n°${number} introuvable sur ce serveur.` };
  if (row.status !== "open") return { error: `La mission n°${number} est déjà ${row.status === "done" ? "terminée" : "annulée"}.` };
  if (cancel && !canManage) return { error: "Seuls les SYS+ et l'OWNER annulent une mission." };
  if (!cancel && !canManage && row.assignee_id !== null && row.assignee_id !== actorId) return { error: "Cette mission est confiée à quelqu'un d'autre." };
  const text = cleanText(report);
  if (!cancel && !text) return { error: "Ajoute un bilan (ce qui a été fait)." };
  db.prepare("UPDATE staff_missions SET status = ?, report = ?, done_by = ?, closed_at = ? WHERE id = ?").run(cancel ? "cancelled" : "done", text || null, actorId, now, row.id);
  return { ok: true };
}

/** Missions done per member over a period (staff analysis: participation, never sanctions). */
export function missionTotals(guildId, sinceMs, { db = defaultDb } = {}) {
  ensureMissionTables(db);
  return new Map(db.prepare("SELECT done_by, COUNT(*) AS n FROM staff_missions WHERE guild_id = ? AND status = 'done' AND closed_at >= ? GROUP BY done_by").all(String(guildId), sinceMs).map((r) => [r.done_by, Number(r.n)]));
}

export function overdueMissions(guildId, { db = defaultDb, now = Date.now() } = {}) {
  ensureMissionTables(db);
  return db.prepare("SELECT number, title, assignee_id, due_at FROM staff_missions WHERE guild_id = ? AND status = 'open' AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at").all(String(guildId), now);
}

// ------------------------------------------------------------------ meetings
export function planMeeting({ guildId, actorId, topic, channelId, startsAt }, { db = defaultDb, now = Date.now() } = {}) {
  ensureMissionTables(db);
  const clean = cleanText(topic, 150);
  if (!clean) return { error: "Indique le sujet de la réunion." };
  if (!(startsAt > now)) return { error: "La réunion doit être dans le futur." };
  const number = nextNumber(db, "staff_meetings", guildId);
  db.prepare("INSERT INTO staff_meetings(guild_id, number, topic, channel_id, starts_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(String(guildId), number, clean, String(channelId), startsAt, actorId, now);
  return { number };
}

export function listMeetings(guildId, { db = defaultDb, now = Date.now(), past = false, limit = 10 } = {}) {
  ensureMissionTables(db);
  return past
    ? db.prepare("SELECT number, topic, starts_at, minutes, minutes_by FROM staff_meetings WHERE guild_id = ? AND cancelled = 0 AND starts_at <= ? ORDER BY starts_at DESC LIMIT ?").all(String(guildId), now, limit)
    : db.prepare("SELECT number, topic, starts_at, channel_id FROM staff_meetings WHERE guild_id = ? AND cancelled = 0 AND starts_at > ? ORDER BY starts_at LIMIT ?").all(String(guildId), now, limit);
}

export function addMinutes({ guildId, number, actorId, text }, { db = defaultDb, now = Date.now() } = {}) {
  ensureMissionTables(db);
  const row = db.prepare("SELECT * FROM staff_meetings WHERE guild_id = ? AND number = ?").get(String(guildId), Number(number));
  if (!row || row.cancelled) return { error: `Réunion n°${number} introuvable sur ce serveur.` };
  if (row.starts_at > now) return { error: "Le compte rendu s'ajoute une fois la réunion commencée." };
  const minutes = cleanText(text, 1500);
  if (!minutes) return { error: "Le compte rendu est vide." };
  db.prepare("UPDATE staff_meetings SET minutes = ?, minutes_by = ? WHERE id = ?").run(minutes, actorId, row.id);
  return { ok: true };
}

export function cancelMeeting({ guildId, number, canManage = false, actorId }, { db = defaultDb } = {}) {
  ensureMissionTables(db);
  const row = db.prepare("SELECT * FROM staff_meetings WHERE guild_id = ? AND number = ?").get(String(guildId), Number(number));
  if (!row || row.cancelled) return { error: `Réunion n°${number} introuvable sur ce serveur.` };
  if (!canManage && row.created_by !== actorId) return { error: "Seuls son auteur, les SYS+ et l'OWNER annulent une réunion." };
  db.prepare("UPDATE staff_meetings SET cancelled = 1 WHERE id = ?").run(row.id);
  return { ok: true };
}

/** Meetings to remind now (30 min before). Marks them so a restart never reminds twice. */
export function takeDueMeetingReminders({ db = defaultDb, now = Date.now() } = {}) {
  ensureMissionTables(db);
  const rows = db.prepare("SELECT id, guild_id, number, topic, channel_id, starts_at FROM staff_meetings WHERE reminded = 0 AND cancelled = 0 AND starts_at - ? <= ?").all(MEETING_REMINDER_MS, now);
  const mark = db.prepare("UPDATE staff_meetings SET reminded = 1 WHERE id = ? AND reminded = 0");
  return rows.filter((row) => mark.run(row.id).changes === 1).filter((row) => row.starts_at > now - MEETING_REMINDER_MS);
}
