// Message collé en bas d'un salon (sticky) : le bot republie un message choisi
// par le staff pour qu'il reste toujours le dernier du salon (règles, liens…).
//
// Pour ne pas inonder le salon, la republication attend un court moment de
// calme (STICKY_DELAY_MS) : dix messages d'affilée ne donnent qu'une seule
// republication.
import { EmbedBuilder } from "discord.js";
import { db } from "../database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_sticky_messages (
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL,
    message_id TEXT, author_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
  );
`);

export const STICKY_MAX_PER_GUILD = 10;
export const STICKY_MAX_LENGTH = 1500;
export const STICKY_DELAY_MS = 8_000;

export const stickyFor = (guildId, channelId) =>
  db.prepare("SELECT * FROM staff_sticky_messages WHERE guild_id=? AND channel_id=?").get(guildId, channelId) ?? null;

export const stickyList = (guildId) =>
  db.prepare("SELECT channel_id AS channelId, content, updated_at AS updatedAt FROM staff_sticky_messages WHERE guild_id=? ORDER BY updated_at")
    .all(guildId).map((r) => ({ channelId: r.channelId, content: r.content, updatedAt: Number(r.updatedAt) }));

/** Pur : nettoie le texte. Les mentions de masse sont refusées (le message est republié souvent). */
export function cleanStickyText(raw) {
  const text = String(raw ?? "").replace(/\\n/g, "\n").trim();
  if (!text) throw new Error("Le message est vide.");
  if (text.length > STICKY_MAX_LENGTH) throw new Error(`Message trop long : ${STICKY_MAX_LENGTH} caractères au maximum.`);
  if (/@(everyone|here)|<@&\d+>/.test(text)) throw new Error("Pas de @everyone, @here ni de mention de rôle dans un message collé.");
  return text;
}

export function setSticky({ guildId, channelId, content, authorId, now = Date.now() }) {
  const text = cleanStickyText(content);
  const exists = stickyFor(guildId, channelId);
  if (!exists) {
    const count = Number(db.prepare("SELECT COUNT(*) AS n FROM staff_sticky_messages WHERE guild_id=?").get(guildId).n);
    if (count >= STICKY_MAX_PER_GUILD) throw new Error(`${STICKY_MAX_PER_GUILD} messages collés au maximum par serveur.`);
  }
  db.prepare(`INSERT INTO staff_sticky_messages(guild_id,channel_id,content,message_id,author_id,updated_at) VALUES(?,?,?,NULL,?,?)
    ON CONFLICT(guild_id,channel_id) DO UPDATE SET content=excluded.content, author_id=excluded.author_id, updated_at=excluded.updated_at`)
    .run(guildId, channelId, text, authorId, now);
  return { previousMessageId: exists?.message_id ?? null, content: text };
}

export function removeSticky(guildId, channelId) {
  const row = stickyFor(guildId, channelId);
  if (!row) return null;
  db.prepare("DELETE FROM staff_sticky_messages WHERE guild_id=? AND channel_id=?").run(guildId, channelId);
  return { previousMessageId: row.message_id ?? null };
}

export function rememberStickyMessage(guildId, channelId, messageId) {
  db.prepare("UPDATE staff_sticky_messages SET message_id=? WHERE guild_id=? AND channel_id=?").run(messageId, guildId, channelId);
}

export function stickyPayload(content) {
  return {
    embeds: [new EmbedBuilder().setColor(0x64748b).setDescription(content).setFooter({ text: "📌 Message épinglé par le staff" })],
    allowedMentions: { parse: [] },
  };
}

/** Republie le message collé tout en bas. Ne fait rien si c'est déjà le dernier message. */
export async function repostSticky(channel) {
  const guildId = channel?.guild?.id ?? channel?.guildId;
  if (!guildId) return false;
  const row = stickyFor(guildId, channel.id);
  if (!row) return false;
  if (row.message_id && channel.lastMessageId === row.message_id) return false;
  const sent = await channel.send(stickyPayload(row.content));
  // Le message a pu être retiré pendant l'envoi : on ne garde pas une copie orpheline.
  if (!stickyFor(guildId, channel.id)) {
    await sent.delete().catch(() => {});
    return false;
  }
  rememberStickyMessage(guildId, channel.id, sent.id);
  if (row.message_id) await channel.messages.delete(row.message_id).catch(() => {});
  return true;
}

const timers = new Map();

/**
 * messageCreate : planifie une republication après un moment de calme.
 * `delay` et `schedule` sont injectables pour les tests.
 */
export function onStickyChannelMessage(message, { botUserId, delay = STICKY_DELAY_MS, schedule = setTimeout, cancel = clearTimeout, onError = () => {} } = {}) {
  if (!message?.guildId || message.author?.id === botUserId) return false;
  if (!stickyFor(message.guildId, message.channelId)) return false;
  const key = `${message.guildId}:${message.channelId}`;
  if (timers.has(key)) cancel(timers.get(key));
  const timer = schedule(() => {
    timers.delete(key);
    void repostSticky(message.channel).catch(onError);
  }, delay);
  timer?.unref?.();
  timers.set(key, timer);
  return true;
}
