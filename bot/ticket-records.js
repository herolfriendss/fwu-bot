import { db } from "./database.js";

/**
 * Ticket timeline (metadata only) and opt-in transcripts with bounded retention.
 *
 * Transcripts are disabled unless PND_TICKET_TRANSCRIPT_DAYS is set to 1–90.
 * When enabled, the text of the ticket channel is captured at close (500
 * messages max, 200 000 characters max), stored in SQLite with an expiry and
 * purged automatically. Only ticket staff can read it.
 */
db.exec(`CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, ticket_id INTEGER NOT NULL,
  action TEXT NOT NULL, actor_id TEXT, target_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events(guild_id,ticket_id,id);
CREATE TABLE IF NOT EXISTS ticket_transcripts (
  ticket_id INTEGER NOT NULL, guild_id TEXT NOT NULL, content TEXT NOT NULL, message_count INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS ticket_transcripts_expiry_idx ON ticket_transcripts(expires_at);`);

const ACTIONS = new Set([
  "opened",
  "claimed",
  "assigned",
  "member_added",
  "member_removed",
  "closed",
  "channel_deleted",
  "template_sent",
]);
export const TRANSCRIPT_MAX_MESSAGES = 500;
export const TRANSCRIPT_MAX_CHARS = 200_000;

export function transcriptRetentionDays(
  value = process.env.PND_TICKET_TRANSCRIPT_DAYS,
) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 0;
}

export function recordTicketEvent({
  guildId,
  ticketId,
  action,
  actorId = null,
  targetId = null,
  now = Date.now(),
}) {
  if (
    !ACTIONS.has(action) ||
    !guildId ||
    !Number.isSafeInteger(Number(ticketId))
  )
    return false;
  db.prepare(
    "INSERT INTO ticket_events(guild_id,ticket_id,action,actor_id,target_id,created_at) VALUES(?,?,?,?,?,?)",
  ).run(guildId, Number(ticketId), action, actorId, targetId, now);
  return true;
}

export function listTicketEvents(guildId, ticketId) {
  return db
    .prepare(
      "SELECT action,actor_id,target_id,created_at FROM ticket_events WHERE guild_id=? AND ticket_id=? ORDER BY id LIMIT 100",
    )
    .all(guildId, Number(ticketId));
}

const LABELS = {
  opened: "ouvert",
  claimed: "pris en charge",
  assigned: "assigné",
  member_added: "membre ajouté",
  member_removed: "membre retiré",
  closed: "fermé",
  channel_deleted: "salon supprimé manuellement",
  template_sent: "réponse rapide envoyée",
};
export function formatTicketTimeline(ticketId, events) {
  if (!events.length)
    return `Aucun événement enregistré pour le ticket #${ticketId}.`;
  return [
    `🧾 **Historique du ticket #${ticketId}**`,
    ...events.map(
      (e) =>
        `• <t:${Math.floor(e.created_at / 1000)}:f> — ${LABELS[e.action] ?? e.action}${e.actor_id ? ` par <@${e.actor_id}>` : ""}${e.target_id ? ` → <@${e.target_id}>` : ""}`,
    ),
  ].join("\n");
}

/** Pure: renders fetched messages (oldest first) into bounded plain text. */
export function renderTranscript(
  messages,
  { maxChars = TRANSCRIPT_MAX_CHARS } = {},
) {
  const lines = [];
  let size = 0;
  let truncated = false;
  for (const m of messages) {
    const attachments = m.attachments?.length
      ? ` [${m.attachments.length} pièce(s) jointe(s)]`
      : "";
    const line = `[${new Date(m.createdTimestamp).toISOString()}] ${m.authorTag ?? m.authorId} (${m.authorId}): ${String(m.content ?? "").replace(/\r/g, "")}${attachments}`;
    if (size + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return { text: lines.join("\n"), truncated, count: lines.length };
}

/** Fetches up to TRANSCRIPT_MAX_MESSAGES from a channel, oldest first. */
export async function fetchChannelMessages(
  channel,
  limit = TRANSCRIPT_MAX_MESSAGES,
) {
  const collected = [];
  let before;
  while (collected.length < limit) {
    const batch = await channel.messages
      .fetch({
        limit: Math.min(100, limit - collected.length),
        ...(before ? { before } : {}),
      })
      .catch(() => null);
    if (!batch?.size) break;
    for (const m of batch.values())
      collected.push({
        createdTimestamp: m.createdTimestamp,
        authorId: m.author?.id,
        authorTag: m.author?.tag,
        content: m.content,
        attachments: [...(m.attachments?.values?.() ?? [])],
      });
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

export function saveTranscript({
  guildId,
  ticketId,
  rendered,
  days,
  now = Date.now(),
}) {
  if (!days) return false;
  db.prepare(
    `INSERT INTO ticket_transcripts(ticket_id,guild_id,content,message_count,truncated,created_at,expires_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(guild_id,ticket_id) DO UPDATE SET content=excluded.content,message_count=excluded.message_count,truncated=excluded.truncated,created_at=excluded.created_at,expires_at=excluded.expires_at`,
  ).run(
    Number(ticketId),
    guildId,
    rendered.text,
    rendered.count,
    rendered.truncated ? 1 : 0,
    now,
    now + days * 86_400_000,
  );
  return true;
}

export function getTranscript(guildId, ticketId, now = Date.now()) {
  const row = db
    .prepare(
      "SELECT * FROM ticket_transcripts WHERE guild_id=? AND ticket_id=? AND expires_at>?",
    )
    .get(guildId, Number(ticketId), now);
  return row
    ? {
        content: row.content,
        messageCount: row.message_count,
        truncated: row.truncated === 1,
        expiresAt: row.expires_at,
      }
    : null;
}

export function purgeExpiredTranscripts(now = Date.now()) {
  return Number(
    db.prepare("DELETE FROM ticket_transcripts WHERE expires_at<=?").run(now)
      .changes,
  );
}
