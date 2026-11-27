// SUCK ME — note des tickets : à la fermeture, l'auteur du ticket reçoit en MP cinq boutons (1 à 5 ★)
// pour noter le support. La note va au membre du staff qui a pris le ticket (sinon à celui qui l'a fermé).
// Une seule note par ticket, valable 7 jours. `/ticket notes` : moyenne et nombre de notes par modérateur.
import { db } from "../database.js";

export const RATING_PREFIX = "trating:";
export const RATING_TTL_MS = 7 * 86_400_000;

db.exec(`CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL,
  stars INTEGER, asked_at INTEGER NOT NULL, rated_at INTEGER
)`);

export const stars = (n) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;

/** Prépare la demande de note. Rend null si personne à noter (fermé par l'auteur lui-même sans preneur). */
export function prepareRating({ guildId, ticketId, userId, claimedBy, closerId }, now = Date.now()) {
  const moderatorId = claimedBy || (closerId !== userId ? closerId : null);
  if (!moderatorId || moderatorId === userId) return null;
  db.prepare("INSERT OR IGNORE INTO ticket_ratings(ticket_id,guild_id,user_id,moderator_id,asked_at) VALUES(?,?,?,?,?)").run(Number(ticketId), guildId, userId, moderatorId, now);
  return { ticketId: Number(ticketId), moderatorId };
}

export function ratingButtons(guildId, ticketId) {
  return [{ type: 1, components: [1, 2, 3, 4, 5].map((n) => ({ type: 2, style: n >= 4 ? 3 : n <= 2 ? 4 : 2, label: `${n} ★`, custom_id: `${RATING_PREFIX}${guildId}:${ticketId}:${n}` })) }];
}

/** Enregistre la note. Rend { ok, message }. */
export function rateTicket({ ticketId, userId, value }, now = Date.now()) {
  const row = db.prepare("SELECT * FROM ticket_ratings WHERE ticket_id=?").get(Number(ticketId));
  if (!row) return { ok: false, message: "Ce ticket ne peut pas être noté." };
  if (row.user_id !== userId) return { ok: false, message: "Seul l'auteur du ticket peut le noter." };
  if (row.stars != null) return { ok: false, message: `Déjà noté : ${stars(row.stars)}.` };
  if (now - row.asked_at > RATING_TTL_MS) return { ok: false, message: "Trop tard : la note n'est plus possible après 7 jours." };
  const n = Math.round(Number(value));
  if (!(n >= 1 && n <= 5)) return { ok: false, message: "Note invalide." };
  db.prepare("UPDATE ticket_ratings SET stars=?, rated_at=? WHERE ticket_id=? AND stars IS NULL").run(n, now, row.ticket_id);
  return { ok: true, message: `Merci ! Tu as donné ${stars(n)} au support.`, stars: n, moderatorId: row.moderator_id, guildId: row.guild_id };
}

/** Moyenne par modérateur, meilleure d'abord. */
export function ratingStats(guildId, limit = 15) {
  return db.prepare(`SELECT moderator_id, AVG(stars) AS avg, COUNT(*) AS n FROM ticket_ratings
    WHERE guild_id=? AND stars IS NOT NULL GROUP BY moderator_id ORDER BY avg DESC, n DESC LIMIT ?`).all(guildId, limit)
    .map((r) => ({ moderatorId: r.moderator_id, average: Math.round(Number(r.avg) * 10) / 10, count: Number(r.n) }));
}

export function formatRatingStats(rows) {
  if (!rows.length) return "Aucune note de ticket pour l'instant.";
  return `⭐ **Notes des tickets**\n${rows.map((r, i) => `${i + 1}. <@${r.moderatorId}> · **${r.average.toLocaleString("fr-FR")}/5** ${stars(Math.round(r.average))} (${r.count} note${r.count > 1 ? "s" : ""})`).join("\n")}`;
}

/** Après la fermeture : MP à l'auteur avec les boutons. Ne bloque jamais la fermeture. */
export async function askTicketRating(guild, row, closerId) {
  const prepared = prepareRating({ guildId: guild.id, ticketId: row.id, userId: row.user_id, claimedBy: row.claimed_by, closerId });
  if (!prepared) return false;
  const user = await guild.client?.users?.fetch?.(row.user_id).catch(() => null);
  const sent = await user?.send?.({
    content: `🎫 Ton ticket **#${row.id}** sur **${guild.name}** est fermé. Comment s'est passé le support ? Note de 1 à 5 :`,
    components: ratingButtons(guild.id, row.id),
    allowedMentions: { parse: [] },
  }).catch(() => null);
  return Boolean(sent);
}

/** Bouton de note (en MP). */
export async function handleTicketRatingButton(interaction, now = Date.now()) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith(RATING_PREFIX)) return false;
  const [, , ticketId, value] = interaction.customId.split(":");
  const result = rateTicket({ ticketId, userId: interaction.user?.id, value }, now);
  if (result.ok) await interaction.update({ content: `✅ ${result.message}`, components: [] }).catch(() => {});
  else await interaction.reply({ content: `⚠️ ${result.message}`, ephemeral: true }).catch(() => {});
  return true;
}
