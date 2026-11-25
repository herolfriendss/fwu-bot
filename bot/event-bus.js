// Shared event bus for the five FWU bots.
//
// The bots are separate processes on one SQLite file, so they talk by writing
// rows here and reading them back. A publisher never knows who reacts; a
// consumer keeps its own cursor and is woken by a poll, which makes a bot that
// was offline catch up instead of missing what happened.
import { db, transaction } from "./database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS fwu_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL, kind TEXT NOT NULL,
    actor_id TEXT, subject_id TEXT, payload_json TEXT NOT NULL,
    source TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fwu_events_feed ON fwu_events(id);
  CREATE INDEX IF NOT EXISTS fwu_events_guild ON fwu_events(guild_id, kind, id);
  CREATE TABLE IF NOT EXISTS fwu_event_cursor (
    consumer TEXT PRIMARY KEY, last_id INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`);

/** Everything the bots may publish. Unknown kinds are refused so typos surface at once. */
export const EVENT_KINDS = Object.freeze([
  "member.joined", "member.left",
  "member.warned", "member.muted", "member.kicked", "member.banned", "member.unbanned",
  "member.quarantined", "member.verified",
  "member.levelup", "member.achievement", "member.birthday",
  "economy.bigwin", "economy.jackpot", "economy.bankrupt",
  "voice.joined", "voice.left", "music.played",
  "sanction.expired", "trust.changed",
  "clan.created", "clan.joined", "clan.left", "clan.war",
  "quest.completed", "season.started", "season.ended",
  "confession.posted",
]);
const KNOWN = new Set(EVENT_KINDS);

const RETENTION_MS = 14 * 24 * 60 * 60_000;
const MAX_BATCH = 200;
const validId = (value) => typeof value === "string" && /^\d{5,25}$/.test(value);

/**
 * Records one event. Returns its id, or 0 when the guild id is unusable —
 * publishing must never be able to break the action that triggered it.
 */
export function publishEvent({ guildId, kind, actorId = null, subjectId = null, payload = {}, source, now = Date.now() }) {
  if (!KNOWN.has(kind)) throw new Error(`Événement inconnu : ${kind}`);
  if (!validId(guildId)) return 0;
  const json = JSON.stringify(payload ?? {});
  if (json.length > 4000) throw new Error("Charge utile d'événement trop grande.");
  const info = db.prepare(`INSERT INTO fwu_events(guild_id,kind,actor_id,subject_id,payload_json,source,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(guildId, kind, actorId, subjectId, json, String(source ?? "fwu"), now);
  return Number(info.lastInsertRowid);
}

/** Never throws: a publish failure must not roll back the moderation or economy action. */
export function publishEventSafe(event) {
  try {
    return publishEvent(event);
  } catch (error) {
    console.error("[bus] publication impossible:", error?.message ?? "erreur");
    return 0;
  }
}

const hydrate = (row) => ({
  id: Number(row.id), guildId: row.guild_id, kind: row.kind,
  actorId: row.actor_id, subjectId: row.subject_id,
  payload: JSON.parse(row.payload_json), source: row.source, createdAt: Number(row.created_at),
});

export const cursorOf = (consumer) =>
  Number(db.prepare("SELECT last_id FROM fwu_event_cursor WHERE consumer=?").get(consumer)?.last_id ?? 0);

/**
 * A consumer that has never run starts at the newest event instead of
 * replaying two weeks of history the moment a bot is deployed.
 */
export function initCursor(consumer, now = Date.now()) {
  if (db.prepare("SELECT 1 FROM fwu_event_cursor WHERE consumer=?").get(consumer)) return cursorOf(consumer);
  const latest = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM fwu_events").get().id);
  db.prepare("INSERT INTO fwu_event_cursor(consumer,last_id,updated_at) VALUES(?,?,?)").run(consumer, latest, now);
  return latest;
}

export function pendingEvents(consumer, { kinds = null, limit = 50, guildIds = null } = {}) {
  const after = cursorOf(consumer);
  const bounded = Math.min(MAX_BATCH, Math.max(1, Number(limit) || 50));
  const rows = db.prepare("SELECT * FROM fwu_events WHERE id>? ORDER BY id LIMIT ?").all(after, bounded).map(hydrate);
  const wanted = kinds ? new Set(kinds) : null;
  const guilds = guildIds ? new Set(guildIds) : null;
  return rows.filter((event) => (!wanted || wanted.has(event.kind)) && (!guilds || guilds.has(event.guildId)));
}

export const advanceCursor = (consumer, lastId, now = Date.now()) =>
  db.prepare(`INSERT INTO fwu_event_cursor(consumer,last_id,updated_at) VALUES(?,?,?)
    ON CONFLICT(consumer) DO UPDATE SET last_id=MAX(fwu_event_cursor.last_id,excluded.last_id), updated_at=excluded.updated_at`)
    .run(consumer, Number(lastId), now);

/**
 * Reads the batch, hands each event to `handler`, then moves the cursor past
 * the whole batch — including events the filter dropped, so a filtered kind
 * never makes the consumer re-read it forever. A handler that throws is logged
 * and skipped: one bad event cannot wedge the queue.
 */
export async function consumeEvents(consumer, handler, options = {}) {
  const after = cursorOf(consumer);
  const batch = pendingEvents(consumer, options);
  const bounded = Math.min(MAX_BATCH, Math.max(1, Number(options.limit) || 50));
  const scanned = db.prepare("SELECT COALESCE(MAX(id),?) AS id FROM (SELECT id FROM fwu_events WHERE id>? ORDER BY id LIMIT ?)")
    .get(after, after, bounded).id;
  let handled = 0;
  for (const event of batch) {
    try {
      await handler(event);
      handled += 1;
    } catch (error) {
      console.error(`[bus] ${consumer} a échoué sur ${event.kind}#${event.id}:`, error?.message ?? "erreur");
    }
  }
  if (Number(scanned) > after) advanceCursor(consumer, scanned);
  return { handled, scanned: Number(scanned), read: batch.length };
}

export function recentEvents(guildId, { kinds = null, limit = 20 } = {}) {
  const bounded = Math.min(100, Math.max(1, Number(limit) || 20));
  if (!kinds?.length) {
    return db.prepare("SELECT * FROM fwu_events WHERE guild_id=? ORDER BY id DESC LIMIT ?").all(guildId, bounded).map(hydrate);
  }
  const marks = kinds.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM fwu_events WHERE guild_id=? AND kind IN (${marks}) ORDER BY id DESC LIMIT ?`)
    .all(guildId, ...kinds, bounded).map(hydrate);
}

/** Keeps the table bounded; cursors below the cut are pulled up so nothing replays. */
export function pruneEvents(now = Date.now()) {
  return transaction(() => {
    const cutoff = now - RETENTION_MS;
    const floor = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM fwu_events WHERE created_at<?").get(cutoff).id);
    if (!floor) return 0;
    db.prepare("UPDATE fwu_event_cursor SET last_id=? WHERE last_id<?").run(floor, floor);
    return Number(db.prepare("DELETE FROM fwu_events WHERE created_at<?").run(cutoff).changes);
  });
}
