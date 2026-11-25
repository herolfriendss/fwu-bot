// Mur des célébrités (starboard) : un message qui reçoit assez d'étoiles est
// recopié dans un salon « vedette », avec un lien vers l'original.
//
// Confidentialité : seuls les messages des salons visibles par @everyone sont
// recopiés. Un message d'un salon privé (staff, tickets…) ne sort jamais.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db } from "../database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS animation_starboard_config (
    guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    emoji TEXT NOT NULL DEFAULT '⭐', threshold INTEGER NOT NULL DEFAULT 3, allow_self INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS animation_starboard_posts (
    guild_id TEXT NOT NULL, source_message_id TEXT NOT NULL, source_channel_id TEXT NOT NULL,
    author_id TEXT, star_message_id TEXT, stars INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, source_message_id)
  );
`);

export const STAR_THRESHOLD_MIN = 1;
export const STAR_THRESHOLD_MAX = 50;
const MAX_TEXT = 3500;

export function starboardConfig(guildId) {
  const row = db.prepare("SELECT * FROM animation_starboard_config WHERE guild_id=?").get(guildId);
  return {
    channelId: row?.channel_id ?? null,
    enabled: row ? Boolean(row.enabled) : false,
    emoji: row?.emoji ?? "⭐",
    threshold: Number(row?.threshold ?? 3),
    allowSelf: row ? Boolean(row.allow_self) : false,
  };
}

/** Pur : un emoji Unicode court, ou un emoji perso Discord <:nom:id> / <a:nom:id>. */
export function normalizeStarEmoji(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "⭐";
  const custom = /^<a?:([A-Za-z0-9_]{2,32}):(\d{17,20})>$/.exec(value);
  if (custom) return custom[2];
  if (value.length <= 8 && !/[\s<>@#:`*_~|]/.test(value) && /\p{Extended_Pictographic}/u.test(value)) return value;
  throw new Error("Emoji invalide : choisis un emoji simple (⭐, 🔥…) ou un emoji du serveur.");
}

/** Pur : l'emoji de la réaction correspond-il à celui configuré ? (Unicode : son texte ; perso : son id.) */
export function reactionMatches(configEmoji, reactionEmoji) {
  if (!reactionEmoji) return false;
  if (reactionEmoji.id) return reactionEmoji.id === configEmoji;
  return String(reactionEmoji.name ?? "").replace(/️/g, "") === String(configEmoji).replace(/️/g, "");
}

export function saveStarboardConfig(guildId, patch) {
  const next = { ...starboardConfig(guildId), ...patch };
  const threshold = Math.trunc(Number(next.threshold));
  if (!Number.isFinite(threshold) || threshold < STAR_THRESHOLD_MIN || threshold > STAR_THRESHOLD_MAX) {
    throw new Error(`Le seuil doit être entre ${STAR_THRESHOLD_MIN} et ${STAR_THRESHOLD_MAX} étoiles.`);
  }
  db.prepare(`INSERT INTO animation_starboard_config(guild_id,channel_id,enabled,emoji,threshold,allow_self) VALUES(?,?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, enabled=excluded.enabled, emoji=excluded.emoji,
    threshold=excluded.threshold, allow_self=excluded.allow_self`)
    .run(guildId, next.channelId, next.enabled ? 1 : 0, next.emoji, threshold, next.allowSelf ? 1 : 0);
  return starboardConfig(guildId);
}

export const starPost = (guildId, sourceMessageId) =>
  db.prepare("SELECT * FROM animation_starboard_posts WHERE guild_id=? AND source_message_id=?").get(guildId, sourceMessageId) ?? null;

export function rememberStarPost({ guildId, sourceMessageId, sourceChannelId, authorId, starMessageId, stars, now = Date.now() }) {
  db.prepare(`INSERT INTO animation_starboard_posts(guild_id,source_message_id,source_channel_id,author_id,star_message_id,stars,created_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(guild_id,source_message_id) DO UPDATE SET stars=excluded.stars,
    star_message_id=COALESCE(excluded.star_message_id, star_message_id)`)
    .run(guildId, sourceMessageId, sourceChannelId, authorId, starMessageId, stars, now);
}

/**
 * Pur : que faire avec ce nombre d'étoiles ?
 * "create" la première fois que le seuil est atteint, "update" ensuite, "none" sinon.
 * Un message déjà en vedette le reste : son compteur suit simplement les étoiles.
 */
export function starboardAction({ stars, threshold, existing }) {
  if (existing?.star_message_id) return Number(existing.stars) === stars ? "none" : "update";
  return stars >= threshold ? "create" : "none";
}

/** Pur : compte les étoiles valides (pas de bot ; pas l'auteur, sauf si autorisé). */
export function countStars(users, authorId, allowSelf) {
  let n = 0;
  for (const user of users) {
    if (user?.bot) continue;
    if (!allowSelf && user?.id === authorId) continue;
    n++;
  }
  return n;
}

/** Le salon d'origine est-il public (visible par @everyone) ? */
export function isPublicChannel(channel) {
  const everyone = channel?.guild?.roles?.everyone;
  if (!everyone || typeof channel?.permissionsFor !== "function") return false;
  return Boolean(channel.permissionsFor(everyone)?.has?.(PermissionFlagsBits.ViewChannel));
}

function displayEmoji(emoji) {
  return /^\d{17,20}$/.test(emoji) ? `<:e:${emoji}>` : emoji;
}

/** Pur : le message publié dans le salon vedette. */
export function starPayload(message, stars, emoji) {
  const text = String(message.content ?? "");
  const embed = new EmbedBuilder()
    .setColor(0xf5b301)
    .setAuthor({ name: message.member?.displayName ?? message.author?.username ?? "Membre", iconURL: message.author?.displayAvatarURL?.() ?? undefined })
    .setDescription([
      text ? (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text) : null,
      `\n[Aller au message](${message.url})`,
    ].filter(Boolean).join("\n"))
    .setTimestamp(message.createdTimestamp ?? Date.now());
  const image = [...(message.attachments?.values?.() ?? [])].find((a) => String(a.contentType ?? "").startsWith("image/"));
  if (image) embed.setImage(image.url);
  return {
    content: `${displayEmoji(emoji)} **${stars}** · <#${message.channelId}>`,
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

// Deux réactions presque simultanées ne doivent pas créer deux copies.
const inflight = new Map();
function serialize(key, task) {
  const previous = inflight.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  inflight.set(key, next);
  void next.finally(() => { if (inflight.get(key) === next) inflight.delete(key); }).catch(() => {});
  return next;
}

/**
 * Appelé sur messageReactionAdd / messageReactionRemove.
 * @returns {Promise<"created" | "updated" | null>}
 */
export function handleStarReaction(reaction) {
  const message = reaction?.message;
  const guildId = message?.guildId ?? message?.guild?.id;
  if (!guildId) return Promise.resolve(null);
  const config = starboardConfig(guildId);
  if (!config.enabled || !config.channelId) return Promise.resolve(null);
  if (!reactionMatches(config.emoji, reaction.emoji)) return Promise.resolve(null);
  if (message.channelId === config.channelId) return Promise.resolve(null);

  return serialize(`${guildId}:${message.id}`, async () => {
    if (reaction.partial) await reaction.fetch();
    const full = message.partial ? await message.fetch() : message;
    if (!full.guild || full.author?.bot) return null;
    if (!isPublicChannel(full.channel)) return null;
    const users = await reaction.users.fetch({ limit: 100 });
    const stars = countStars(users.values(), full.author?.id, config.allowSelf);
    const existing = starPost(guildId, full.id);
    const action = starboardAction({ stars, threshold: config.threshold, existing });
    if (action === "none") return null;

    const channel = await full.guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return null;
    const payload = starPayload(full, stars, config.emoji);
    if (action === "update") {
      const posted = await channel.messages.fetch(existing.star_message_id).catch(() => null);
      if (posted) await posted.edit(payload);
      rememberStarPost({ guildId, sourceMessageId: full.id, sourceChannelId: full.channelId, authorId: full.author?.id, starMessageId: null, stars });
      return "updated";
    }
    const sent = await channel.send(payload);
    rememberStarPost({ guildId, sourceMessageId: full.id, sourceChannelId: full.channelId, authorId: full.author?.id, starMessageId: sent.id, stars });
    return "created";
  });
}

export function starboardStats(guildId) {
  const row = db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(stars),0) AS best FROM animation_starboard_posts WHERE guild_id=? AND star_message_id IS NOT NULL").get(guildId);
  const top = db.prepare(`SELECT author_id AS userId, COUNT(*) AS posts FROM animation_starboard_posts
    WHERE guild_id=? AND star_message_id IS NOT NULL AND author_id IS NOT NULL GROUP BY author_id ORDER BY posts DESC LIMIT 5`).all(guildId);
  return { posts: Number(row.n), best: Number(row.best), top: top.map((r) => ({ userId: r.userId, posts: Number(r.posts) })) };
}
