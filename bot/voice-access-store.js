import { db, transaction } from "./database.js";

/** Expire requests that can no longer be acted on. Processing requests get a
 * short grace period so a Discord API call already in flight is not interrupted. */
export function expireVoiceAccessRequests(now = Date.now(), processingGraceMs = 5 * 60_000) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(processingGraceMs) || processingGraceMs < 0 || processingGraceMs > 30 * 60_000) {
    throw new Error("Paramètres d'expiration des demandes vocales invalides.");
  }
  return transaction(() => {
    const pending = db.prepare("UPDATE voice_access_requests SET status='expired',decided_at=?,decision_note='Expiration automatique' WHERE status='pending' AND expires_at<=?")
      .run(now, now);
    const processing = db.prepare("UPDATE voice_access_requests SET status='expired',decided_at=?,decision_note='Traitement interrompu après expiration' WHERE status='processing' AND expires_at<=?")
      .run(now, now - processingGraceMs);
    return Number(pending.changes) + Number(processing.changes);
  });
}

export function removeVoiceAccessBlock({ guildId, channelId, userId, actorId, authorizeActor, now = Date.now() }) {
  for (const id of [guildId, channelId, userId, actorId]) {
    if (typeof id !== "string" || !/^\d{5,25}$/.test(id)) throw new Error("Identifiant de demande vocale invalide.");
  }
  const channel = db.prepare("SELECT owner_user_id,active FROM voice_private_channels WHERE guild_id=? AND channel_id=?").get(guildId, channelId);
  if (!channel || channel.active !== 1) throw new Error("Vocale privée introuvable ou inactive.");
  const allowed = actorId === channel.owner_user_id || (typeof authorizeActor === "function" && authorizeActor({ guildId, channelId, actorId, ownerId: channel.owner_user_id, action: "voice_access.unblock" }) === true);
  if (!allowed) throw new Error("Seul le propriétaire de la vocale ou le staff autorisé peut débloquer un membre.");
  const result = db.prepare("DELETE FROM voice_access_blocks WHERE guild_id=? AND channel_id=? AND user_id=?")
    .run(guildId, channelId, userId);
  return { removed: Number(result.changes) > 0, channelId, userId, updatedAt: now };
}
