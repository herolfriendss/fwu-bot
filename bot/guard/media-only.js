// GUARD — salons médias uniquement (/medias).
//   Dans un salon déclaré : un message sans image, vidéo ni lien est supprimé (avis effacé après 6 s),
//   et chaque média reçoit un fil « Commentaires » pour en discuter sans encombrer le salon.
//   Le staff (Gérer les messages) peut écrire librement.
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";

export const MEDIA_COMMANDS = new Set(["medias"]);

db.exec(`CREATE TABLE IF NOT EXISTS guard_media_channels (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, threads INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, channel_id))`);

const cache = new Map(); // channelId → { threads } | null

export function mediaChannel(channelId) {
  if (cache.has(channelId)) return cache.get(channelId);
  const row = db.prepare("SELECT threads FROM guard_media_channels WHERE channel_id=?").get(channelId);
  const value = row ? { threads: Boolean(row.threads) } : null;
  cache.set(channelId, value);
  return value;
}

export function setMediaChannel(guildId, channelId, { threads = true, actorId = null } = {}, now = Date.now()) {
  db.prepare(`INSERT INTO guard_media_channels(guild_id,channel_id,threads,created_by,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,channel_id) DO UPDATE SET threads=excluded.threads`).run(guildId, channelId, threads ? 1 : 0, actorId, now);
  cache.delete(channelId);
}

export function removeMediaChannel(channelId) {
  cache.delete(channelId);
  return Number(db.prepare("DELETE FROM guard_media_channels WHERE channel_id=?").run(channelId).changes) > 0;
}

export function listMediaChannels(guildId) {
  return db.prepare("SELECT channel_id, threads FROM guard_media_channels WHERE guild_id=? ORDER BY created_at").all(guildId);
}

const MEDIA_LINK = /https?:\/\/\S+/i;

/** Le message contient-il un média (pièce jointe image/vidéo/audio, autocollant, lien) ? */
export function hasMedia(message) {
  for (const attachment of message?.attachments?.values?.() ?? []) {
    const type = String(attachment.contentType ?? "");
    if (!type || /^(image|video|audio)\//.test(type)) return true;
  }
  if ((message?.stickers?.size ?? 0) > 0) return true;
  return MEDIA_LINK.test(String(message?.content ?? ""));
}

export function threadName(message) {
  const who = message.member?.displayName ?? message.author?.username ?? "membre";
  return `💬 Commentaires · ${who}`.slice(0, 100);
}

/** Rend true seulement si le message a été supprimé (texte seul) : la suite du traitement s'arrête alors. */
export async function handleMediaOnlyMessage(message) {
  if (!message?.guild || message.author?.bot || message.system) return false;
  const config = mediaChannel(message.channelId);
  if (!config) return false;
  if (hasMedia(message)) {
    if (config.threads && message.channel?.type === ChannelType.GuildText && typeof message.startThread === "function" && !message.hasThread) {
      await message.startThread({ name: threadName(message), autoArchiveDuration: 1440, reason: "Salon médias : fil de commentaires" }).catch(() => null);
    }
    return false;
  }
  if (message.member?.permissions?.has?.(P.ManageMessages) || message.member?.permissions?.has?.(P.Administrator)) return false;
  await message.delete().catch(() => null);
  const notice = await message.channel?.send?.({ content: `📸 <@${message.author.id}>, ce salon est réservé aux médias : commente dans le fil sous chaque publication.`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (notice) setTimeout(() => { notice.delete().catch(() => {}); }, 6_000).unref?.();
  return true;
}

export async function handleMediaOnlyInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "medias" || !interaction.guild) return false;
  const member = interaction.member;
  if (!(member?.permissions?.has?.(P.ManageChannels) || member?.permissions?.has?.(P.Administrator) || member?.id === interaction.guild.ownerId)) {
    await interaction.reply({ content: "⛔ Réservé au staff (Gérer les salons).", ephemeral: true }).catch(() => {});
    return true;
  }
  const sub = interaction.options.getSubcommand(false) ?? "liste";
  let content;
  if (sub === "ajouter") {
    const channel = interaction.options.getChannel("salon", true);
    const threads = interaction.options.getBoolean("fils", false) ?? true;
    setMediaChannel(interaction.guild.id, channel.id, { threads, actorId: interaction.user.id });
    content = `📸 <#${channel.id}> est maintenant un salon médias uniquement${threads ? ", avec un fil de commentaires sous chaque média" : ""}. Il me faut **Gérer les messages**${threads ? " et **Créer des fils publics**" : ""} dans ce salon.`;
  } else if (sub === "retirer") {
    const channel = interaction.options.getChannel("salon", true);
    content = removeMediaChannel(channel.id) ? `✅ <#${channel.id}> redevient un salon normal.` : `<#${channel.id}> n'était pas un salon médias.`;
  } else {
    const rows = listMediaChannels(interaction.guild.id);
    content = rows.length ? `📸 Salons médias : ${rows.map((r) => `<#${r.channel_id}>${r.threads ? "" : " (sans fils)"}`).join(", ")}` : "Aucun salon médias.";
  }
  await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
