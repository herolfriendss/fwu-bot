// STAFF CENTER (SUCK ME) — disponibilités hebdomadaires et astreintes du staff.
//
// /staff dispo creneaux:"lun-ven 18-23, sam 14-2"   → créneaux habituels (heure de Paris)
// /staff astreinte action:prendre|terminer|voir [duree]
// /staff disponibles                                → qui est joignable maintenant
//
// Règles : chacun ne déclare que pour lui-même ; une astreinte ne donne AUCUN rôle ni
// permission Discord (simple indication pour l'équipe) ; données isolées par serveur ;
// les absences de /staff absence passent avant les disponibilités.
import { db as defaultDb } from "./database.js";

export const DAYS = Object.freeze(["dim", "lun", "mar", "mer", "jeu", "ven", "sam"]);
const DAY_ALIASES = Object.freeze({
  dim: 0, dimanche: 0, lun: 1, lundi: 1, mar: 2, mardi: 2, mer: 3, mercredi: 3,
  jeu: 4, jeudi: 4, ven: 5, vendredi: 5, sam: 6, samedi: 6,
});
export const MAX_SLOTS = 21;
export const MAX_ON_CALL_MS = 7 * 24 * 3_600_000;
export const DEFAULT_ON_CALL_MS = 12 * 3_600_000;
export const TIME_ZONE = "Europe/Paris";

export function ensureAvailabilityTables(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_availability (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, slots_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS staff_on_call (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, started_at INTEGER NOT NULL, until_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS staff_on_call_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS staff_on_call_history_guild ON staff_on_call_history(guild_id, started_at);
  `);
}

function parseDays(text) {
  const t = text.trim().toLowerCase();
  if (t === "tous" || t === "tlj" || t === "7j") return [0, 1, 2, 3, 4, 5, 6];
  if (t === "semaine") return [1, 2, 3, 4, 5];
  if (t === "weekend" || t === "week-end") return [6, 0];
  const range = t.match(/^([a-zé]+)\s*-\s*([a-zé]+)$/);
  if (range) {
    const from = DAY_ALIASES[range[1]]; const to = DAY_ALIASES[range[2]];
    if (from === undefined || to === undefined) return null;
    const days = []; let d = from;
    for (let i = 0; i < 7; i++) { days.push(d); if (d === to) break; d = (d + 1) % 7; }
    return days;
  }
  const list = t.split(/\s*\/\s*|\s+et\s+/).map((part) => DAY_ALIASES[part]);
  return list.every((d) => d !== undefined) ? list : null;
}

function parseHour(text) {
  const m = String(text).trim().toLowerCase().match(/^(\d{1,2})(?:h|:)?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/**
 * "lun-ven 18-23, sam 14h-2h, dim 10:30-12" → [{ day, start, end }] (minutes, heure de Paris).
 * Un créneau qui passe minuit (14-2) continue le jour suivant. Erreur lisible sinon.
 */
export function parseSlots(input) {
  const text = String(input ?? "").trim();
  if (!text) return { error: "Indique au moins un créneau, par exemple « lun-ven 18-23 »." };
  if (/^(aucun|aucune|rien|effacer)$/i.test(text)) return { slots: [] };
  const slots = [];
  for (const chunk of text.split(/[,;\n]+/).map((c) => c.trim()).filter(Boolean)) {
    const m = chunk.match(/^(.+?)\s+(\S+)\s*-\s*(\S+)$/);
    if (!m) return { error: `Créneau illisible : « ${chunk.slice(0, 40)} ». Exemple : « lun-ven 18-23 ».` };
    const days = parseDays(m[1]);
    const start = parseHour(m[2]); const end = parseHour(m[3]);
    if (!days) return { error: `Jours illisibles : « ${m[1].slice(0, 30)} » (lun, mar… ; lun-ven ; semaine ; weekend ; tous).` };
    if (start === null || end === null || start === end) return { error: `Heures illisibles dans « ${chunk.slice(0, 40)} » (ex. 18-23, 14h-2h, 9:30-12).` };
    for (const day of days) slots.push({ day, start, end });
  }
  if (slots.length > MAX_SLOTS) return { error: `Trop de créneaux (${slots.length}, maximum ${MAX_SLOTS}).` };
  return { slots };
}

/** Jour (0 = dimanche) et minute de la journée à Paris pour un instant donné. */
export function parisClock(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isWithinSlots(slots, clock) {
  return slots.some(({ day, start, end }) => {
    if (start < end) return day === clock.day && clock.minute >= start && clock.minute < end;
    // Passe minuit : fin de soirée du jour même, ou début de journée du lendemain.
    return (day === clock.day && clock.minute >= start) || ((day + 1) % 7 === clock.day && clock.minute < end);
  });
}

const hhmm = (minutes) => `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, "0") : ""}`;
export function formatSlots(slots) {
  if (!slots.length) return "aucun créneau";
  const byRange = new Map();
  for (const { day, start, end } of slots) {
    const key = `${hhmm(start)}-${hhmm(end)}`;
    byRange.set(key, [...(byRange.get(key) ?? []), day]);
  }
  return [...byRange].map(([range, days]) => `${[...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(" ")} ${range}`).join(" · ");
}

export function saveAvailability(guildId, userId, slots, { db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  if (!slots.length) { db.prepare("DELETE FROM staff_availability WHERE guild_id = ? AND user_id = ?").run(guildId, userId); return; }
  db.prepare(`INSERT INTO staff_availability(guild_id, user_id, slots_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET slots_json = excluded.slots_json, updated_at = excluded.updated_at`).run(guildId, userId, JSON.stringify(slots), now);
}

export function availabilityOf(guildId, userId, { db = defaultDb } = {}) {
  ensureAvailabilityTables(db);
  const row = db.prepare("SELECT slots_json FROM staff_availability WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  try { return row ? JSON.parse(row.slots_json) : []; } catch { return []; }
}

export function startOnCall(guildId, userId, durationMs = DEFAULT_ON_CALL_MS, { db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  const duration = Math.min(MAX_ON_CALL_MS, Math.max(15 * 60_000, Number(durationMs) || DEFAULT_ON_CALL_MS));
  const until = now + duration;
  db.prepare(`INSERT INTO staff_on_call(guild_id, user_id, started_at, until_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET until_at = excluded.until_at`).run(guildId, userId, now, until);
  return until;
}

/** Ends an on-call shift (manual or expired) and keeps it in the history. */
export function endOnCall(guildId, userId, { db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  const row = db.prepare("SELECT started_at, until_at FROM staff_on_call WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  if (!row) return false;
  db.prepare("INSERT INTO staff_on_call_history(guild_id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)").run(guildId, userId, Number(row.started_at), Math.min(now, Number(row.until_at)));
  db.prepare("DELETE FROM staff_on_call WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
  return true;
}

/** Closes expired shifts (works after a restart: expiry is stored, not kept in a timer). */
export function expireOnCall({ db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  const due = db.prepare("SELECT guild_id, user_id FROM staff_on_call WHERE until_at <= ?").all(now);
  for (const row of due) endOnCall(row.guild_id, row.user_id, { db, now });
  return due.length;
}

export function activeOnCall(guildId, { db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  return db.prepare("SELECT user_id, started_at, until_at FROM staff_on_call WHERE guild_id = ? AND until_at > ? ORDER BY until_at")
    .all(guildId, now).map((row) => ({ userId: row.user_id, startedAt: Number(row.started_at), until: Number(row.until_at) }));
}

/** Total on-call time per member over a period (for the staff analysis, never a sanction). */
export function onCallTotals(guildId, sinceMs, { db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  const totals = new Map();
  for (const row of db.prepare("SELECT user_id, started_at, ended_at FROM staff_on_call_history WHERE guild_id = ? AND ended_at > ?").all(guildId, sinceMs)) {
    totals.set(row.user_id, (totals.get(row.user_id) ?? 0) + Number(row.ended_at) - Math.max(Number(row.started_at), sinceMs));
  }
  for (const shift of activeOnCall(guildId, { db, now })) totals.set(shift.userId, (totals.get(shift.userId) ?? 0) + now - Math.max(shift.startedAt, sinceMs));
  return totals;
}

/**
 * Who can be reached now among `staffIds`: on call first, then available by their slots;
 * members declared absent (/staff absence) are left out.
 */
export function reachableStaff(guildId, staffIds, { absentIds = new Set(), db = defaultDb, now = Date.now() } = {}) {
  ensureAvailabilityTables(db);
  const clock = parisClock(now);
  const onCall = new Set(activeOnCall(guildId, { db, now }).map((s) => s.userId));
  const rows = db.prepare("SELECT user_id, slots_json FROM staff_availability WHERE guild_id = ?").all(guildId);
  const slots = new Map(rows.map((row) => { try { return [row.user_id, JSON.parse(row.slots_json)]; } catch { return [row.user_id, []]; } }));
  const result = { onCall: [], available: [], declaredNone: [] };
  for (const id of new Set(staffIds)) {
    if (absentIds.has(id)) continue;
    if (onCall.has(id)) result.onCall.push(id);
    else if (slots.has(id) && isWithinSlots(slots.get(id), clock)) result.available.push(id);
    else if (!slots.has(id)) result.declaredNone.push(id);
  }
  return result;
}

// ---------------------------------------------------------------- Weekly planning (1.2)
export const PLANNING_BANDS = Object.freeze([
  { label: "0h-6h", start: 0, end: 360 },
  { label: "6h-12h", start: 360, end: 720 },
  { label: "12h-18h", start: 720, end: 1080 },
  { label: "18h-24h", start: 1080, end: 1440 },
]);

/** Members available at some point of a band (day, start..end). */
function coversBand(slots, day, band) {
  for (let minute = band.start; minute < band.end; minute += 30) {
    if (isWithinSlots(slots, { day, minute })) return true;
  }
  return false;
}

/**
 * Coverage grid for the week: grid[day][band] = number of staff members available.
 * Days are ordered Monday → Sunday. `gaps` lists the bands nobody covers.
 */
export function weeklyCoverage(guildId, staffIds, { db = defaultDb } = {}) {
  ensureAvailabilityTables(db);
  const wanted = new Set(staffIds);
  const all = db.prepare("SELECT user_id, slots_json FROM staff_availability WHERE guild_id = ?").all(guildId)
    .filter((row) => wanted.has(row.user_id))
    .map((row) => { try { return JSON.parse(row.slots_json); } catch { return []; } });
  const order = [1, 2, 3, 4, 5, 6, 0];
  const grid = order.map((day) => PLANNING_BANDS.map((band) => all.filter((slots) => coversBand(slots, day, band)).length));
  const gaps = [];
  order.forEach((day, i) => PLANNING_BANDS.forEach((band, j) => { if (grid[i][j] === 0) gaps.push(`${DAYS[day]} ${band.label}`); }));
  return { days: order.map((d) => DAYS[d]), bands: PLANNING_BANDS.map((b) => b.label), grid, gaps, declared: all.length };
}

export function formatCoverage({ days, bands, grid, gaps, declared }) {
  const pad = (v, n) => String(v).padEnd(n);
  const lines = [`${pad("", 4)}${bands.map((b) => pad(b, 8)).join("")}`];
  days.forEach((day, i) => lines.push(`${pad(day, 4)}${grid[i].map((n) => pad(n === 0 ? "·" : n, 8)).join("")}`));
  return `\`\`\`\n${lines.join("\n")}\n\`\`\`\n${declared} membre(s) du staff ont déclaré leurs créneaux.${gaps.length ? `\n⚠️ Personne : ${gaps.slice(0, 12).join(", ")}${gaps.length > 12 ? "…" : ""}` : "\n✅ Chaque tranche est couverte."}`;
}

// ---------------------------------------------------------------- Handover notes (1.2)
export const HANDOVER_MAX = 1500;

export function ensureHandoverTable(db = defaultDb) {
  db.exec(`CREATE TABLE IF NOT EXISTS staff_handover (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, author_id TEXT NOT NULL,
    note TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS staff_handover_guild ON staff_handover(guild_id, id);`);
}

/** Stores a handover note. Mentions are neutralised: a note never pings anyone. */
export function addHandover(guildId, authorId, note, { db = defaultDb, now = Date.now() } = {}) {
  ensureHandoverTable(db);
  const text = String(note ?? "").replace(/@(everyone|here)/gi, "@​$1").trim().slice(0, HANDOVER_MAX);
  if (!text) return { error: "La note de passation est vide." };
  const id = Number(db.prepare("INSERT INTO staff_handover(guild_id, author_id, note, created_at) VALUES (?, ?, ?, ?)").run(guildId, authorId, text, now).lastInsertRowid);
  return { id, note: text };
}

export function recentHandovers(guildId, { db = defaultDb, limit = 5 } = {}) {
  ensureHandoverTable(db);
  return db.prepare("SELECT id, author_id, note, created_at FROM staff_handover WHERE guild_id = ? ORDER BY id DESC LIMIT ?").all(guildId, limit)
    .map((row) => ({ id: Number(row.id), authorId: row.author_id, note: row.note, createdAt: Number(row.created_at) }));
}
