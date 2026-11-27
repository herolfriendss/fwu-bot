// GUARD — détecteur de mention fantôme : quelqu'un mentionne un membre (ou un rôle, @everyone)
// puis supprime ou modifie son message dans les 3 minutes pour effacer la mention.
// GUARD le signale dans le salon (sans re-mentionner personne) et dans les logs de modération.
// Aucun contenu de message n'est conservé : seules les mentions servent.
// Désactivable avec PND_GHOST_PING=off.

export const GHOST = Object.freeze({ windowMs: 3 * 60_000, authorCooldownMs: 30_000, repeatWindowMs: 10 * 60_000, repeatAlert: 3 });

const lastNotice = new Map(); // `${guildId}:${authorId}` → horodatage
const history = new Map(); // `${guildId}:${authorId}` → [horodatages]

/** Mentions d'un message : membres (hors bots et auteur), rôles, @everyone/@here. */
export function mentionsOf(message) {
  const authorId = message?.author?.id;
  const users = [...(message?.mentions?.users?.values?.() ?? [])].filter((u) => !u.bot && u.id !== authorId).map((u) => u.id);
  const roles = [...(message?.mentions?.roles?.keys?.() ?? [])];
  return { users, roles, everyone: Boolean(message?.mentions?.everyone) };
}

const hasAny = (m) => m.users.length > 0 || m.roles.length > 0 || m.everyone;

/**
 * Mentions effacées : message supprimé (`after` absent) ou modifié (mentions retirées).
 * Rend null si rien à signaler (trop ancien, bot, message inconnu, aucune mention retirée).
 */
export function ghostMentions(before, after = null, now = Date.now()) {
  if (!before || before.partial || !before.author || before.author.bot || !before.guild) return null;
  if (!before.createdTimestamp || now - before.createdTimestamp > GHOST.windowMs) return null;
  const old = mentionsOf(before);
  if (!hasAny(old)) return null;
  if (!after) return old;
  const kept = mentionsOf(after);
  const removed = {
    users: old.users.filter((id) => !kept.users.includes(id)),
    roles: old.roles.filter((id) => !kept.roles.includes(id)),
    everyone: old.everyone && !kept.everyone,
  };
  return hasAny(removed) ? removed : null;
}

/** Anti-spam : un avis par auteur toutes les 30 s ; rend aussi le nombre de cas en 10 min. */
export function noteGhost(guildId, authorId, now = Date.now()) {
  const key = `${guildId}:${authorId}`;
  const recent = (history.get(key) ?? []).filter((at) => now - at < GHOST.repeatWindowMs);
  recent.push(now);
  history.set(key, recent);
  if (history.size > 5_000) for (const [k, list] of history) if (!list.some((at) => now - at < GHOST.repeatWindowMs)) history.delete(k);
  const quiet = now - (lastNotice.get(key) ?? 0) < GHOST.authorCooldownMs;
  if (!quiet) lastNotice.set(key, now);
  return { notify: !quiet, count: recent.length };
}

export function ghostText(authorId, mentions, edited = false) {
  const targets = [
    ...mentions.users.map((id) => `<@${id}>`),
    ...mentions.roles.map((id) => `<@&${id}>`),
    ...(mentions.everyone ? ["@everyone"] : []),
  ];
  const shown = targets.slice(0, 10).join(", ") + (targets.length > 10 ? ` et ${targets.length - 10} autre(s)` : "");
  return `👻 **Mention fantôme** : <@${authorId}> a mentionné ${shown} puis a ${edited ? "retiré la mention de son message" : "supprimé son message"}.`;
}

/**
 * Point d'entrée (messageDelete : `after` null ; messageUpdate : ancien et nouveau message).
 * `sendLog(text, count)` publie dans les logs de modération.
 */
export async function handleGhostPing(before, after = null, { sendLog = async () => {}, record = () => {}, now = Date.now(), env = process.env } = {}) {
  if (String(env.PND_GHOST_PING ?? "").toLowerCase() === "off") return false;
  const mentions = ghostMentions(before, after, now);
  if (!mentions) return false;
  const { notify, count } = noteGhost(before.guild.id, before.author.id, now);
  record("ghost_ping");
  const text = ghostText(before.author.id, mentions, Boolean(after));
  if (notify) await before.channel?.send?.({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  await sendLog(`${text}\nSalon : <#${before.channelId}>${count >= GHOST.repeatAlert ? `\n⚠️ **${count} mentions fantômes en 10 minutes** pour ce membre.` : ""}`, count).catch(() => null);
  return true;
}
