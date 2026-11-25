// Question du jour : chaque jour, à l'heure choisie (heure de Paris), le bot
// publie une question et ouvre un fil pour y répondre.
// Les questions ajoutées par le staff passent en premier ; ensuite, le bot pioche
// dans sa liste sans jamais répéter une question avant d'avoir fait le tour.
import { EmbedBuilder } from "discord.js";
import { db, transaction } from "../database.js";
import { BUILTIN_QUESTIONS } from "./qotd-questions.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS animation_qotd_config (
    guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    hour INTEGER NOT NULL DEFAULT 18, role_id TEXT, thread INTEGER NOT NULL DEFAULT 1,
    last_day TEXT, posted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS animation_qotd_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, text TEXT NOT NULL,
    added_by TEXT NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS animation_qotd_questions_queue ON animation_qotd_questions(guild_id, used_at, id);
  CREATE TABLE IF NOT EXISTS animation_qotd_builtin_used (
    guild_id TEXT NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY (guild_id, idx)
  );
`);

export const QOTD_TIMEZONE = "Europe/Paris";
export const QOTD_MAX_LENGTH = 300;
export const QOTD_MAX_QUEUE = 200;

/** Pur : date (AAAA-MM-JJ) et heure à Paris pour un instant donné. */
export function parisClock(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: QOTD_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Pur : faut-il publier maintenant ? Une fois par jour, à partir de l'heure choisie. */
export function isQotdDue(config, now = Date.now()) {
  if (!config?.enabled || !config.channelId) return false;
  const clock = parisClock(now);
  return clock.hour >= Number(config.hour) && config.lastDay !== clock.day;
}

export function qotdConfig(guildId) {
  const row = db.prepare("SELECT * FROM animation_qotd_config WHERE guild_id=?").get(guildId);
  return {
    channelId: row?.channel_id ?? null,
    enabled: row ? Boolean(row.enabled) : false,
    hour: Number(row?.hour ?? 18),
    roleId: row?.role_id ?? null,
    thread: row ? Boolean(row.thread) : true,
    lastDay: row?.last_day ?? null,
    posted: Number(row?.posted ?? 0),
  };
}

export function saveQotdConfig(guildId, patch) {
  const next = { ...qotdConfig(guildId), ...patch };
  const hour = Math.trunc(Number(next.hour));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("L'heure doit être entre 0 et 23.");
  db.prepare(`INSERT INTO animation_qotd_config(guild_id,channel_id,enabled,hour,role_id,thread,last_day,posted) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, enabled=excluded.enabled, hour=excluded.hour,
    role_id=excluded.role_id, thread=excluded.thread`)
    .run(guildId, next.channelId, next.enabled ? 1 : 0, hour, next.roleId, next.thread ? 1 : 0, next.lastDay, next.posted);
  return qotdConfig(guildId);
}

/** Pur : nettoie une question proposée par le staff. */
export function cleanQuestion(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 5) throw new Error("Question trop courte.");
  if (text.length > QOTD_MAX_LENGTH) throw new Error(`Question trop longue : ${QOTD_MAX_LENGTH} caractères au maximum.`);
  if (/@(everyone|here)|<@&?\d+>/.test(text)) throw new Error("Pas de mention dans une question.");
  return text;
}

export function addQuestion(guildId, text, addedBy, now = Date.now()) {
  const clean = cleanQuestion(text);
  const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM animation_qotd_questions WHERE guild_id=? AND used_at IS NULL").get(guildId).n);
  if (pending >= QOTD_MAX_QUEUE) throw new Error(`File pleine : ${QOTD_MAX_QUEUE} questions en attente au maximum.`);
  const info = db.prepare("INSERT INTO animation_qotd_questions(guild_id,text,added_by,created_at) VALUES(?,?,?,?)").run(guildId, clean, addedBy, now);
  return { id: Number(info.lastInsertRowid), pending: pending + 1 };
}

export const pendingQuestions = (guildId) =>
  Number(db.prepare("SELECT COUNT(*) AS n FROM animation_qotd_questions WHERE guild_id=? AND used_at IS NULL").get(guildId).n);

/**
 * Réserve la prochaine question : d'abord la file du staff, sinon une question
 * intégrée pas encore posée (le tour recommence quand tout a été posé).
 * `random` est injectable pour les tests.
 */
export function nextQuestion(guildId, { now = Date.now(), random = Math.random } = {}) {
  return transaction(() => {
    const custom = db.prepare("SELECT id, text FROM animation_qotd_questions WHERE guild_id=? AND used_at IS NULL ORDER BY id LIMIT 1").get(guildId);
    if (custom) {
      db.prepare("UPDATE animation_qotd_questions SET used_at=? WHERE id=?").run(now, custom.id);
      return { text: custom.text, source: "staff", id: Number(custom.id) };
    }
    const used = new Set(db.prepare("SELECT idx FROM animation_qotd_builtin_used WHERE guild_id=?").all(guildId).map((r) => Number(r.idx)));
    let free = BUILTIN_QUESTIONS.map((_, i) => i).filter((i) => !used.has(i));
    if (!free.length) {
      db.prepare("DELETE FROM animation_qotd_builtin_used WHERE guild_id=?").run(guildId);
      free = BUILTIN_QUESTIONS.map((_, i) => i);
    }
    const idx = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
    db.prepare("INSERT OR IGNORE INTO animation_qotd_builtin_used(guild_id,idx) VALUES(?,?)").run(guildId, idx);
    return { text: BUILTIN_QUESTIONS[idx], source: "builtin", id: idx };
  });
}

/** Pur : le message publié. */
export function qotdPayload(question, number, roleId = null) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`❓ Question du jour #${number}`)
    .setDescription(`**${question.text}**`)
    .setFooter({ text: "Réponds dans le fil ci-dessous" });
  return {
    content: roleId ? `<@&${roleId}>` : undefined,
    embeds: [embed],
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
  };
}

/** Marque le jour comme fait AVANT d'envoyer : jamais deux questions le même jour. */
function claimDay(guildId, day) {
  return Number(db.prepare("UPDATE animation_qotd_config SET last_day=?, posted=posted+1 WHERE guild_id=? AND (last_day IS NULL OR last_day<>?)")
    .run(day, guildId, day).changes) > 0;
}
function releaseDay(guildId, previous) {
  db.prepare("UPDATE animation_qotd_config SET last_day=?, posted=MAX(posted-1,0) WHERE guild_id=?").run(previous, guildId);
}

/**
 * Publie la question du jour. `force` : publication immédiate demandée par le staff
 * (compte comme la question du jour).
 * @returns {Promise<{ ok: true, number: number, text: string } | { ok: false, reason: string }>}
 */
export async function postQotd(guild, { now = Date.now(), force = false } = {}) {
  const config = qotdConfig(guild.id);
  if (!config.channelId) return { ok: false, reason: "Aucun salon configuré." };
  if (!force && !isQotdDue(config, now)) return { ok: false, reason: "Pas encore l'heure." };
  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, reason: "Salon introuvable ou inaccessible." };
  const { day } = parisClock(now);
  const previous = config.lastDay;
  if (force) db.prepare("UPDATE animation_qotd_config SET last_day=NULL WHERE guild_id=?").run(guild.id);
  if (!claimDay(guild.id, day)) return { ok: false, reason: "Déjà publiée aujourd'hui." };
  const question = nextQuestion(guild.id, { now });
  const number = qotdConfig(guild.id).posted;
  try {
    const sent = await channel.send(qotdPayload(question, number, config.roleId));
    if (config.thread && typeof sent.startThread === "function") {
      const name = `Réponses — ${day.split("-").reverse().join("/")}`;
      await sent.startThread({ name, autoArchiveDuration: 1440 }).catch(() => null);
    }
    return { ok: true, number, text: question.text };
  } catch {
    releaseDay(guild.id, previous);
    if (question.source === "staff") db.prepare("UPDATE animation_qotd_questions SET used_at=NULL WHERE id=?").run(question.id);
    return { ok: false, reason: "Envoi refusé par Discord (permissions du salon ?)." };
  }
}

/** Tâche planifiée (toutes les 5 min) : publie là où c'est l'heure. */
export async function runQotd(guilds, now = Date.now()) {
  let posted = 0;
  for (const guild of guilds) {
    if (!isQotdDue(qotdConfig(guild.id), now)) continue;
    const result = await postQotd(guild, { now });
    if (result.ok) posted++;
  }
  return posted;
}
