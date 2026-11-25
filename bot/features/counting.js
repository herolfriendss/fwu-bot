// Salon de comptage : les membres comptent 1, 2, 3… chacun son tour.
// Un mauvais nombre, ou deux nombres d'affilée par la même personne, remet le
// compteur à zéro. Le serveur garde son record et un classement des compteurs.
//
// Les messages qui ne commencent pas par un nombre sont ignorés : on peut
// discuter dans le salon sans casser la série.
import { db } from "../database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS animation_counting (
    guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    current INTEGER NOT NULL DEFAULT 0, last_user_id TEXT, last_message_id TEXT,
    record INTEGER NOT NULL DEFAULT 0, record_at INTEGER, fails INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS animation_counting_scores (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0, mistakes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

/** Plus grand nombre accepté : au-delà, ce n'est plus un jeu. */
export const COUNT_MAX = 999_999_999;
/** Paliers fêtés par une réaction spéciale. */
export const MILESTONES = Object.freeze([100, 250, 500, 1000, 2500, 5000, 10000]);

/** Pur : le nombre au début du message, ou null. « 12 », « 12 !! », « 12 c'est moi » → 12. */
export function parseCount(content) {
  const match = /^\s*(\d{1,9})(?![\d.,])/.exec(String(content ?? ""));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 && value <= COUNT_MAX ? value : null;
}

/**
 * Pur : verdict pour un nombre posté.
 * @returns {{ ok: true, next: number, record: boolean, milestone: boolean } | { ok: false, reason: "wrong_number" | "same_user", expected: number }}
 */
export function evaluateCount(state, userId, value) {
  const expected = Number(state?.current ?? 0) + 1;
  if (state?.lastUserId && state.lastUserId === userId) return { ok: false, reason: "same_user", expected };
  if (value !== expected) return { ok: false, reason: "wrong_number", expected };
  return {
    ok: true,
    next: value,
    record: value > Number(state?.record ?? 0),
    milestone: MILESTONES.includes(value),
  };
}

export function countingConfig(guildId) {
  const row = db.prepare("SELECT * FROM animation_counting WHERE guild_id=?").get(guildId);
  return {
    channelId: row?.channel_id ?? null,
    enabled: row ? Boolean(row.enabled) : false,
    current: Number(row?.current ?? 0),
    lastUserId: row?.last_user_id ?? null,
    lastMessageId: row?.last_message_id ?? null,
    record: Number(row?.record ?? 0),
    recordAt: row?.record_at == null ? null : Number(row.record_at),
    fails: Number(row?.fails ?? 0),
  };
}

/** Choisit le salon et active le jeu. Changer de salon repart de zéro, le record est gardé. */
export function setCountingChannel(guildId, channelId) {
  const before = countingConfig(guildId);
  const keep = before.channelId === channelId;
  db.prepare(`INSERT INTO animation_counting(guild_id,channel_id,enabled,current,last_user_id,last_message_id)
    VALUES(?,?,1,0,NULL,NULL) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, enabled=1,
    current=CASE WHEN ? THEN current ELSE 0 END,
    last_user_id=CASE WHEN ? THEN last_user_id ELSE NULL END,
    last_message_id=CASE WHEN ? THEN last_message_id ELSE NULL END`)
    .run(guildId, channelId, keep ? 1 : 0, keep ? 1 : 0, keep ? 1 : 0);
  return countingConfig(guildId);
}

export function disableCounting(guildId) {
  return Number(db.prepare("UPDATE animation_counting SET enabled=0 WHERE guild_id=?").run(guildId).changes) > 0;
}

/**
 * Applique un message du salon de comptage. Synchrone (SQLite) : deux messages
 * qui arrivent en même temps sont traités l'un après l'autre, jamais mélangés.
 * @returns {null | ReturnType<typeof evaluateCount> & { value: number, broken?: number }}
 */
export function applyCount({ guildId, channelId, userId, messageId, content, now = Date.now() }) {
  const state = countingConfig(guildId);
  if (!state.enabled || !state.channelId || state.channelId !== channelId) return null;
  const value = parseCount(content);
  if (value === null) return null;
  const verdict = evaluateCount(state, userId, value);
  const score = db.prepare(`INSERT INTO animation_counting_scores(guild_id,user_id,correct,mistakes) VALUES(?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET correct=correct+excluded.correct, mistakes=mistakes+excluded.mistakes`);
  if (verdict.ok) {
    db.prepare(`UPDATE animation_counting SET current=?, last_user_id=?, last_message_id=?,
      record=MAX(record, ?), record_at=CASE WHEN ? > record THEN ? ELSE record_at END WHERE guild_id=?`)
      .run(value, userId, messageId, value, value, now, guildId);
    score.run(guildId, userId, 1, 0);
    return { ...verdict, value };
  }
  db.prepare("UPDATE animation_counting SET current=0, last_user_id=NULL, last_message_id=NULL, fails=fails+1 WHERE guild_id=?").run(guildId);
  score.run(guildId, userId, 0, 1);
  return { ...verdict, value, broken: state.current };
}

/**
 * Le dernier nombre valide a été supprimé : le jeu continue, mais on rappelle
 * à tous où on en est (sinon plus personne ne sait quoi écrire).
 * @returns {null | { current: number, userId: string }}
 */
export function countDeleted(guildId, channelId, messageId) {
  const state = countingConfig(guildId);
  if (!state.enabled || state.channelId !== channelId || !messageId || state.lastMessageId !== messageId) return null;
  db.prepare("UPDATE animation_counting SET last_message_id=NULL WHERE guild_id=?").run(guildId);
  return { current: state.current, userId: state.lastUserId };
}

export function countingLeaderboard(guildId, limit = 10) {
  return db.prepare(`SELECT user_id AS userId, correct, mistakes FROM animation_counting_scores
    WHERE guild_id=? AND correct>0 ORDER BY correct DESC, mistakes ASC LIMIT ?`).all(guildId, limit)
    .map((row) => ({ userId: row.userId, correct: Number(row.correct), mistakes: Number(row.mistakes) }));
}

/** Pur : la phrase publiée quand quelqu'un casse la série. */
export function breakMessage(userId, verdict) {
  const why = verdict.reason === "same_user"
    ? "on ne compte pas deux fois d'affilée"
    : `il fallait écrire **${verdict.expected}**`;
  const lost = Number(verdict.broken ?? 0);
  return `💥 <@${userId}> a cassé la série${lost > 0 ? ` à **${lost}**` : ""} : ${why}. On repart de **1** !`;
}
