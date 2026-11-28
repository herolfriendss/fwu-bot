// GUARD — arrivées et départs anormaux : compteurs par heure, comparés à la même heure des 7 jours
// précédents. Alerte (jamais de sanction) quand une heure dépasse nettement la normale.
import { db } from "../database.js";

db.exec(`CREATE TABLE IF NOT EXISTS member_flow (guild_id TEXT NOT NULL, hour INTEGER NOT NULL, joins INTEGER NOT NULL DEFAULT 0, leaves INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, hour));
  CREATE TABLE IF NOT EXISTS member_flow_alerts (guild_id TEXT NOT NULL, hour INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (guild_id, hour, kind));`);

export const FLOW_MIN = 8;
export const FLOW_FACTOR = 3;
export const hourOf = (now = Date.now()) => Math.floor(now / 3_600_000);

export function recordFlow(guildId, kind, now = Date.now()) {
  const column = kind === "leave" ? "leaves" : "joins";
  db.prepare(`INSERT INTO member_flow(guild_id, hour, ${column}) VALUES (?,?,1) ON CONFLICT(guild_id, hour) DO UPDATE SET ${column} = ${column} + 1`).run(guildId, hourOf(now));
}

/** Pure: is `count` abnormal compared with the same hour on previous days? */
export function isAbnormal(count, history) {
  const baseline = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  const threshold = Math.max(FLOW_MIN, Math.ceil(baseline * FLOW_FACTOR + 3));
  return { abnormal: count >= threshold, baseline: Math.round(baseline * 10) / 10, threshold };
}

/** Returns new alerts for this guild (each kind at most once per hour). */
export function checkFlow(guildId, now = Date.now()) {
  const hour = hourOf(now);
  const current = db.prepare("SELECT joins, leaves FROM member_flow WHERE guild_id=? AND hour=?").get(guildId, hour) ?? { joins: 0, leaves: 0 };
  const past = db.prepare("SELECT hour, joins, leaves FROM member_flow WHERE guild_id=? AND hour IN (?,?,?,?,?,?,?)")
    .all(guildId, ...Array.from({ length: 7 }, (_, i) => hour - 24 * (i + 1)));
  const byHour = new Map(past.map((r) => [r.hour, r]));
  const alerts = [];
  for (const kind of ["joins", "leaves"]) {
    const history = Array.from({ length: 7 }, (_, i) => Number(byHour.get(hour - 24 * (i + 1))?.[kind] ?? 0));
    const verdict = isAbnormal(Number(current[kind]), history);
    if (!verdict.abnormal) continue;
    const inserted = db.prepare("INSERT OR IGNORE INTO member_flow_alerts VALUES (?,?,?)").run(guildId, hour, kind).changes;
    if (inserted) alerts.push({ kind, count: Number(current[kind]), ...verdict });
  }
  db.prepare("DELETE FROM member_flow WHERE hour < ?").run(hour - 24 * 30);
  db.prepare("DELETE FROM member_flow_alerts WHERE hour < ?").run(hour - 24 * 30);
  return alerts;
}
