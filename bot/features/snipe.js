// Bot principal — /snipe réservé au staff : dernier message supprimé ou modifié d'un salon.
// Gardé en mémoire seulement (jamais en base ni dans les logs), 10 minutes au plus, puis oublié.
// Réponse visible uniquement par le membre du staff qui la demande.
import { EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { memberTier } from "../shared/tiers.js";

export const SNIPE_COMMANDS = new Set(["snipe"]);
export const SNIPE = Object.freeze({ ttlMs: 10 * 60_000, maxChars: 1000, maxChannels: 5_000 });

const store = new Map(); // channelId → { deleted, edited }

function clip(text) {
  const value = String(text ?? "");
  return value.length > SNIPE.maxChars ? `${value.slice(0, SNIPE.maxChars)}…` : value;
}

function put(channelId, kind, entry) {
  const slot = store.get(channelId) ?? {};
  slot[kind] = entry;
  store.set(channelId, slot);
  if (store.size > SNIPE.maxChannels) {
    const now = entry.at;
    for (const [id, s] of store) if (!fresh(s.deleted, now) && !fresh(s.edited, now)) store.delete(id);
  }
}

const fresh = (entry, now) => Boolean(entry && now - entry.at <= SNIPE.ttlMs);

export function rememberDeleted(message, now = Date.now()) {
  if (!message?.guild || message.partial || message.author?.bot || !message.channelId) return false;
  const attachments = message.attachments?.size ?? 0;
  if (!message.content && !attachments) return false;
  put(message.channelId, "deleted", { authorId: message.author.id, content: clip(message.content), attachments, at: now });
  return true;
}

export function rememberEdited(before, after, now = Date.now()) {
  if (!after?.guild || before?.partial || after.author?.bot || before?.content == null || before.content === after.content) return false;
  put(after.channelId, "edited", { authorId: after.author?.id, before: clip(before.content), after: clip(after.content), url: after.url ?? null, at: now });
  return true;
}

export function snipeOf(channelId, kind, now = Date.now()) {
  const entry = store.get(channelId)?.[kind];
  return fresh(entry, now) ? entry : null;
}

export function forgetSnipes() {
  store.clear();
}

async function isSnipeStaff(member) {
  if (!member) return false;
  if (member.id === member.guild?.ownerId || member.permissions?.has?.(P.ManageMessages) || member.permissions?.has?.(P.Administrator)) return true;
  const tier = await memberTier(member).catch(() => null);
  return tier != null && tier <= 10;
}

export function snipeEmbed(kind, entry, channelId) {
  const embed = new EmbedBuilder().setColor(kind === "deleted" ? 0xef4444 : 0xf59e0b)
    .setTitle(kind === "deleted" ? "🗑️ Dernier message supprimé" : "✏️ Dernier message modifié")
    .setTimestamp(new Date(entry.at));
  const lines = [`Auteur : <@${entry.authorId}>`, `Salon : <#${channelId}>`];
  if (kind === "deleted") {
    if (entry.attachments) lines.push(`Pièces jointes : ${entry.attachments}`);
    embed.addFields({ name: "Contenu", value: entry.content || "*(aucun texte)*" });
  } else {
    if (entry.url) lines.push(`Lien : ${entry.url}`);
    embed.addFields({ name: "Avant", value: entry.before || "*(vide)*" }, { name: "Après", value: entry.after || "*(vide)*" });
  }
  return embed.setDescription(lines.join("\n"));
}

export async function handleSnipeInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "snipe" || !interaction.guild) return false;
  if (!(await isSnipeStaff(interaction.member))) {
    await interaction.reply({ content: "⛔ `/snipe` est réservé au staff (Gérer les messages ou palier 10 %).", ephemeral: true }).catch(() => {});
    return true;
  }
  const kind = interaction.options.getString("type", false) === "modifie" ? "edited" : "deleted";
  const channelId = interaction.options.getChannel("salon", false)?.id ?? interaction.channelId;
  const entry = snipeOf(channelId, kind);
  await interaction.reply(entry
    ? { embeds: [snipeEmbed(kind, entry, channelId)], ephemeral: true, allowedMentions: { parse: [] } }
    : { content: `Aucun message ${kind === "deleted" ? "supprimé" : "modifié"} dans <#${channelId}> ces 10 dernières minutes.`, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
