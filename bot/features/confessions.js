// Anonymous confessions: a member writes, attaches an image or records a voice
// note, and the bot publishes it without their name.
//
// Anonymous to the server, never to the staff: every confession is filed with
// its real author in a private review channel. That is what makes it safe to
// run — abuse can always be traced and blocked.
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { db, transaction } from "../database.js";
import { applyBanner } from "../banners.js";
import { publishEventSafe } from "../event-bus.js";
import { permissionFor } from "../trust.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS community_confessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, number INTEGER NOT NULL,
    author_id TEXT NOT NULL, body TEXT, image_url TEXT, audio_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending', channel_id TEXT, message_id TEXT,
    reviewer_id TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS community_confessions_guild ON community_confessions(guild_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS community_confession_config (
    guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
    channel_id TEXT, review_channel_id TEXT, moderated INTEGER NOT NULL DEFAULT 1,
    min_trust INTEGER NOT NULL DEFAULT 40, cooldown_ms INTEGER NOT NULL DEFAULT 3600000,
    daily_limit INTEGER NOT NULL DEFAULT 3
  );
  CREATE TABLE IF NOT EXISTS community_confession_blocks (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, blocked_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
`);

export const MAX_BODY = 1500;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DAY = 86_400_000;

export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const AUDIO_TYPES = Object.freeze(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a"]);
/** Discord's own CDN only: the bot must not be turned into a fetcher for arbitrary URLs. */
const ALLOWED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function confessionConfig(guildId) {
  const row = db.prepare("SELECT * FROM community_confession_config WHERE guild_id=?").get(guildId);
  return {
    enabled: row ? Boolean(row.enabled) : true,
    channelId: row?.channel_id ?? null,
    reviewChannelId: row?.review_channel_id ?? null,
    moderated: row ? Boolean(row.moderated) : true,
    minTrust: Number(row?.min_trust ?? 40),
    cooldownMs: Number(row?.cooldown_ms ?? 3_600_000),
    dailyLimit: Number(row?.daily_limit ?? 3),
  };
}

export function saveConfessionConfig(guildId, patch) {
  const next = { ...confessionConfig(guildId), ...patch };
  db.prepare(`INSERT INTO community_confession_config(guild_id,enabled,channel_id,review_channel_id,moderated,min_trust,cooldown_ms,daily_limit)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, channel_id=excluded.channel_id,
    review_channel_id=excluded.review_channel_id, moderated=excluded.moderated, min_trust=excluded.min_trust,
    cooldown_ms=excluded.cooldown_ms, daily_limit=excluded.daily_limit`)
    .run(guildId, next.enabled ? 1 : 0, next.channelId, next.reviewChannelId, next.moderated ? 1 : 0,
      next.minTrust, next.cooldownMs, next.dailyLimit);
  return next;
}

/** Pure: is this attachment something we are willing to republish? */
export function validateAttachment(attachment, kind) {
  if (!attachment) return { ok: true, url: null };
  const allowed = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES;
  const type = String(attachment.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!allowed.includes(type)) {
    return { ok: false, reason: kind === "image" ? "Format d'image non accepté (PNG, JPEG, GIF ou WEBP)." : "Format audio non accepté (MP3, OGG, WAV, M4A ou WEBM)." };
  }
  if (Number(attachment.size) > MAX_FILE_BYTES) return { ok: false, reason: "Fichier trop lourd : 8 Mo au maximum." };
  let host = "";
  try { host = new URL(attachment.url).hostname; } catch { return { ok: false, reason: "Lien de fichier invalide." }; }
  if (!ALLOWED_HOSTS.has(host)) return { ok: false, reason: "Le fichier doit être joint au message, pas lié." };
  return { ok: true, url: attachment.url, type };
}

export const isBlocked = (guildId, userId) =>
  Boolean(db.prepare("SELECT 1 FROM community_confession_blocks WHERE guild_id=? AND user_id=?").get(guildId, userId));

export const blockConfessor = (guildId, userId, blockedBy, reason = null, now = Date.now()) =>
  db.prepare(`INSERT INTO community_confession_blocks(guild_id,user_id,reason,blocked_by,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason, blocked_by=excluded.blocked_by`)
    .run(guildId, userId, reason, blockedBy, now);

export const unblockConfessor = (guildId, userId) =>
  Number(db.prepare("DELETE FROM community_confession_blocks WHERE guild_id=? AND user_id=?").run(guildId, userId).changes);

/** Every reason a confession can be refused before it is even written down. */
export function canConfess(guildId, userId, { member = null, now = Date.now() } = {}) {
  const config = confessionConfig(guildId);
  if (!config.enabled) return { ok: false, reason: "Les confessions sont désactivées sur ce serveur." };
  if (!config.channelId) return { ok: false, reason: "Aucun salon de confessions n'est configuré. Demande au staff `/confession config`." };
  if (isBlocked(guildId, userId)) return { ok: false, reason: "Tu n'as plus accès aux confessions sur ce serveur." };

  const verdict = permissionFor(guildId, userId, "social", { member, now });
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };
  if (verdict.trust.score < config.minTrust) {
    return { ok: false, reason: `Les confessions demandent un score de confiance d'au moins ${config.minTrust}. Le tien est de ${verdict.trust.score} : participe un peu au serveur d'abord.` };
  }

  const last = db.prepare("SELECT created_at FROM community_confessions WHERE guild_id=? AND author_id=? ORDER BY id DESC").get(guildId, userId);
  if (last && now - Number(last.created_at) < config.cooldownMs) {
    const ready = Math.floor((Number(last.created_at) + config.cooldownMs) / 1000);
    return { ok: false, reason: `Tu pourras envoyer une nouvelle confession <t:${ready}:R>.` };
  }
  const today = Number(db.prepare("SELECT COUNT(*) AS n FROM community_confessions WHERE guild_id=? AND author_id=? AND created_at>?")
    .get(guildId, userId, now - DAY).n);
  if (today >= config.dailyLimit) {
    return { ok: false, reason: `Tu as atteint la limite de ${config.dailyLimit} confessions par jour.` };
  }
  return { ok: true, config, trust: verdict.trust };
}

/** Reserves the public number and files the confession with its real author. */
export function recordConfession({ guildId, authorId, body, imageUrl = null, audioUrl = null, status, now = Date.now() }) {
  const text = String(body ?? "").trim();
  if (!text && !imageUrl && !audioUrl) throw new Error("Une confession doit contenir un texte, une image ou un vocal.");
  if (text.length > MAX_BODY) throw new Error(`Texte trop long : ${MAX_BODY} caractères au maximum.`);
  return transaction(() => {
    const number = Number(db.prepare("SELECT COALESCE(MAX(number),0) + 1 AS n FROM community_confessions WHERE guild_id=?").get(guildId).n);
    const info = db.prepare(`INSERT INTO community_confessions(guild_id,number,author_id,body,image_url,audio_url,status,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(guildId, number, authorId, text || null, imageUrl, audioUrl, status, now);
    return { id: Number(info.lastInsertRowid), number, status };
  });
}

export const confessionById = (id) => db.prepare("SELECT * FROM community_confessions WHERE id=?").get(id) ?? null;

export const markConfession = (id, status, reviewerId, now = Date.now()) =>
  db.prepare("UPDATE community_confessions SET status=?, reviewer_id=?, reviewed_at=? WHERE id=?").run(status, reviewerId, now, id);

export const rememberConfessionMessage = (id, channelId, messageId) =>
  db.prepare("UPDATE community_confessions SET channel_id=?, message_id=? WHERE id=?").run(channelId, messageId, id);

/**
 * Re-uploads the attachment so the published message does not point at the
 * uploader's original CDN link, which carries the source channel and expires.
 */
export async function mirrorAttachment(url, filename, fetchImpl = fetch) {
  if (!url) return null;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > MAX_FILE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_FILE_BYTES) return null;
    return new AttachmentBuilder(buffer, { name: filename });
  } catch {
    return null;
  }
}

const extensionFor = (url, fallback) => {
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return match ? match[1].toLowerCase() : fallback;
  } catch {
    return fallback;
  }
};

/** The public embed. It must never contain anything identifying the author. */
export function confessionEmbed(row) {
  const embed = new EmbedBuilder()
    .setColor(0xe21d2f)
    .setTitle(`🤫 Confession #${row.number}`)
    .setFooter({ text: "Envoie la tienne avec /confession envoyer · elle restera anonyme" })
    .setTimestamp(Number(row.created_at));
  if (row.body) embed.setDescription(row.body);
  return embed;
}

/** Builds the files and embed for a published confession. */
export async function confessionPayload(row, fetchImpl = fetch) {
  const embed = confessionEmbed(row);
  const files = [];
  if (row.image_url) {
    const file = await mirrorAttachment(row.image_url, `confession-${row.number}.${extensionFor(row.image_url, "png")}`, fetchImpl);
    if (file) {
      files.push(file);
      embed.setImage(`attachment://confession-${row.number}.${extensionFor(row.image_url, "png")}`);
    }
  } else {
    applyBanner(embed, "social");
  }
  if (row.audio_url) {
    const file = await mirrorAttachment(row.audio_url, `vocal-${row.number}.${extensionFor(row.audio_url, "ogg")}`, fetchImpl);
    if (file) {
      files.push(file);
      embed.addFields({ name: "🎙️ Note vocale", value: "Lis le fichier joint ci-dessous." });
    }
  }
  return { embeds: [embed], files, allowedMentions: { parse: [] } };
}

/** Publishes to the public channel and records where it landed. */
export async function publishConfession(guild, row, fetchImpl = fetch) {
  const config = confessionConfig(guild.id);
  const channel = config.channelId ? await guild.channels.fetch(config.channelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) throw new Error("Le salon de confessions est introuvable ou illisible.");
  const message = await channel.send(await confessionPayload(row, fetchImpl));
  rememberConfessionMessage(row.id, channel.id, message.id);
  markConfession(row.id, "published", row.reviewer_id ?? null);
  publishEventSafe({
    guildId: guild.id, kind: "confession.posted", source: "fwu",
    payload: { number: row.number, hasImage: Boolean(row.image_url), hasAudio: Boolean(row.audio_url) },
  });
  return message;
}

export function confessionStats(guildId) {
  const row = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected
    FROM community_confessions WHERE guild_id=?`).get(guildId);
  return {
    total: Number(row?.total ?? 0), published: Number(row?.published ?? 0),
    pending: Number(row?.pending ?? 0), rejected: Number(row?.rejected ?? 0),
  };
}
