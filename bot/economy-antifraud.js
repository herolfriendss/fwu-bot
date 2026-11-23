import { db } from "./database.js";

/**
 * PND transfer anti-fraud.
 *
 * Blocking rules (before any balance change):
 * - Discord account younger than PND_TRANSFER_MIN_ACCOUNT_DAYS (7) or member
 *   for less than PND_TRANSFER_MIN_MEMBER_DAYS (3) → refused (alt farming).
 * - More than PND_TRANSFER_DAILY_CAP PND (50 000) or
 *   PND_TRANSFER_DAILY_COUNT (20) transfers sent in 24 h → refused.
 *   WHITELIST is a limit exemption: it lifts the cap/count, never the
 *   account-age rule.
 *
 * Signals (never blocking, reviewed by staff): funnel (one recipient fed by
 * many recent accounts) and ping-pong (A↔B back and forth).
 */
const DAY = 24 * 60 * 60_000;
const envNumber = (name, fallback) =>
  Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback;

export const ANTIFRAUD_LIMITS = Object.freeze({
  minAccountDays: envNumber("PND_TRANSFER_MIN_ACCOUNT_DAYS", 7),
  minMemberDays: envNumber("PND_TRANSFER_MIN_MEMBER_DAYS", 3),
  dailyCap: envNumber("PND_TRANSFER_DAILY_CAP", 50_000),
  dailyCount: envNumber("PND_TRANSFER_DAILY_COUNT", 20),
  funnelSenders: envNumber("PND_TRANSFER_FUNNEL_SENDERS", 5),
  youngMemberDays: envNumber("PND_TRANSFER_YOUNG_MEMBER_DAYS", 14),
});

db.exec(`CREATE TABLE IF NOT EXISTS economy_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0), sender_joined_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS economy_transfers_sender_idx ON economy_transfers(guild_id,sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS economy_transfers_recipient_idx ON economy_transfers(guild_id,recipient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS economy_fraud_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, kind TEXT NOT NULL, subject_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS economy_fraud_signals_guild_idx ON economy_fraud_signals(guild_id,reviewed,created_at DESC);`);

/** Pure decision. */
export function evaluateTransfer({
  amount,
  accountCreatedAt,
  joinedAt,
  sentLast24h = 0,
  countLast24h = 0,
  whitelisted = false,
  now = Date.now(),
  limits = ANTIFRAUD_LIMITS,
}) {
  if (
    !Number.isFinite(accountCreatedAt) ||
    now - accountCreatedAt < limits.minAccountDays * DAY
  ) {
    return {
      allowed: false,
      reason: `Transfert refusé : ton compte Discord doit avoir au moins ${limits.minAccountDays} jours.`,
    };
  }
  if (
    !Number.isFinite(joinedAt) ||
    now - joinedAt < limits.minMemberDays * DAY
  ) {
    return {
      allowed: false,
      reason: `Transfert refusé : il faut être membre du serveur depuis au moins ${limits.minMemberDays} jours.`,
    };
  }
  if (!whitelisted) {
    if (countLast24h >= limits.dailyCount)
      return {
        allowed: false,
        reason: `Limite atteinte : ${limits.dailyCount} transferts par 24 h.`,
      };
    if (sentLast24h + amount > limits.dailyCap) {
      const left = Math.max(0, limits.dailyCap - sentLast24h);
      return {
        allowed: false,
        reason: `Plafond de ${limits.dailyCap.toLocaleString("fr-FR")} PND envoyés par 24 h. Reste possible : ${left.toLocaleString("fr-FR")} PND.`,
      };
    }
  }
  return { allowed: true, reason: null };
}

export function senderWindow(guildId, senderId, now = Date.now()) {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM economy_transfers WHERE guild_id=? AND sender_id=? AND created_at>?",
    )
    .get(guildId, senderId, now - DAY);
  return { sentLast24h: Number(row.total), countLast24h: Number(row.count) };
}

/** Must be called inside the same transaction as the balance change. */
export function recordTransfer({
  guildId,
  senderId,
  recipientId,
  amount,
  senderJoinedAt = null,
  now = Date.now(),
}) {
  db.prepare(
    "INSERT INTO economy_transfers(guild_id,sender_id,recipient_id,amount,sender_joined_at,created_at) VALUES(?,?,?,?,?,?)",
  ).run(guildId, senderId, recipientId, amount, senderJoinedAt, now);
}

function addSignal(guildId, kind, subjectId, details, now) {
  // One open signal per kind/subject per 24 h is enough for review.
  const existing = db
    .prepare(
      "SELECT 1 FROM economy_fraud_signals WHERE guild_id=? AND kind=? AND subject_id=? AND reviewed=0 AND created_at>?",
    )
    .get(guildId, kind, subjectId, now - DAY);
  if (existing) return null;
  db.prepare(
    "INSERT INTO economy_fraud_signals(guild_id,kind,subject_id,details_json,created_at) VALUES(?,?,?,?,?)",
  ).run(guildId, kind, subjectId, JSON.stringify(details), now);
  return { kind, subjectId, details };
}

/** Post-transfer detection. Returns new signals (for logging); never blocks. */
export function detectTransferSignals({
  guildId,
  senderId,
  recipientId,
  now = Date.now(),
  limits = ANTIFRAUD_LIMITS,
}) {
  const signals = [];
  const youngSenders = db
    .prepare(
      `SELECT COUNT(DISTINCT sender_id) AS n, COALESCE(SUM(amount),0) AS total FROM economy_transfers
    WHERE guild_id=? AND recipient_id=? AND created_at>? AND sender_joined_at IS NOT NULL AND sender_joined_at>?`,
    )
    .get(guildId, recipientId, now - DAY, now - limits.youngMemberDays * DAY);
  if (Number(youngSenders.n) >= limits.funnelSenders) {
    const signal = addSignal(
      guildId,
      "funnel",
      recipientId,
      { senders: Number(youngSenders.n), total: Number(youngSenders.total) },
      now,
    );
    if (signal) signals.push(signal);
  }
  const back = db
    .prepare(
      "SELECT COUNT(*) AS n FROM economy_transfers WHERE guild_id=? AND sender_id=? AND recipient_id=? AND created_at>?",
    )
    .get(guildId, recipientId, senderId, now - 60 * 60_000);
  const forth = db
    .prepare(
      "SELECT COUNT(*) AS n FROM economy_transfers WHERE guild_id=? AND sender_id=? AND recipient_id=? AND created_at>?",
    )
    .get(guildId, senderId, recipientId, now - 60 * 60_000);
  if (Number(back.n) >= 2 && Number(forth.n) >= 2) {
    const pair = [senderId, recipientId].sort().join(":");
    const signal = addSignal(
      guildId,
      "ping_pong",
      pair,
      {
        a: senderId,
        b: recipientId,
        transfers: Number(back.n) + Number(forth.n),
      },
      now,
    );
    if (signal) signals.push(signal);
  }
  return signals;
}

export function listFraudSignals(guildId, { limit = 15 } = {}) {
  return db
    .prepare(
      "SELECT id,kind,subject_id,details_json,created_at FROM economy_fraud_signals WHERE guild_id=? AND reviewed=0 ORDER BY created_at DESC LIMIT ?",
    )
    .all(guildId, Math.max(1, Math.min(50, limit)))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      subjectId: row.subject_id,
      details: JSON.parse(row.details_json),
      createdAt: row.created_at,
    }));
}

export function markFraudSignalReviewed(guildId, id) {
  return (
    Number(
      db
        .prepare(
          "UPDATE economy_fraud_signals SET reviewed=1 WHERE guild_id=? AND id=?",
        )
        .run(guildId, id).changes,
    ) > 0
  );
}

export function describeSignal(signal) {
  if (signal.kind === "funnel")
    return `Entonnoir : <@${signal.subjectId}> a reçu des PND de ${signal.details.senders} comptes récents en 24 h (${Number(signal.details.total).toLocaleString("fr-FR")} PND).`;
  if (signal.kind === "ping_pong")
    return `Allers-retours : <@${signal.details.a}> ↔ <@${signal.details.b}> (${signal.details.transfers} transferts en 1 h).`;
  return `${signal.kind} : ${signal.subjectId}`;
}
