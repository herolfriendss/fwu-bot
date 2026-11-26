// FWU V2 — vocal privé qui se réinitialise.
//
// La photo des permissions est prise au passage en privé (voice-lock-store.js, première
// photo conservée). Quand la personne qui l'a rendu privé quitte le salon, un délai de
// grâce (45 s, pour une simple coupure de connexion) est lancé ; si elle n'est pas revenue,
// le salon retrouve ses permissions d'avant (même chemin que =unpv). Au démarrage, aucun
// salon privé abandonné ne reste bloqué.
// Les vocaux temporaires (Join-to-Create) ne sont pas concernés : leur propriété est déjà
// transférée par voice-v2.js quand le propriétaire part (on n'y touche pas).
import { db } from "./database.js";
import { getVoiceLockSnapshot, listVoiceLockSnapshots } from "./voice-lock-store.js";

export const PRIVATE_RESET_GRACE_MS = 45_000;
const timers = new Map();

function isTempVoice(guildId, channelId) {
  try {
    return Boolean(db.prepare("SELECT 1 FROM temp_voice WHERE guild_id = ? AND channel_id = ?").get(String(guildId), String(channelId)));
  } catch {
    return false;
  }
}

/** Décision pure : faut-il rendre au salon ses permissions d'avant ? */
export function shouldResetPrivate({ snapshot, ownerPresent, temporary }) {
  return Boolean(snapshot?.ownerId) && !ownerPresent && !temporary;
}

function ownerIn(channel, ownerId) {
  return Boolean(channel?.members?.has?.(ownerId));
}

async function resetIfAbandoned(guild, channelId, { unlock, record = () => {} }) {
  const snapshot = getVoiceLockSnapshot(channelId);
  const channel = guild.channels?.cache?.get?.(channelId) ?? await guild.channels?.fetch?.(channelId).catch(() => null);
  if (!snapshot || !channel) return false;
  if (!shouldResetPrivate({ snapshot, ownerPresent: ownerIn(channel, snapshot.ownerId), temporary: isTempVoice(guild.id, channelId) })) return false;
  try {
    await unlock(channel);
    record("pv_reset");
    return true;
  } catch {
    record("pv_reset_error");
    return false;
  }
}

/**
 * voiceStateUpdate : départ du propriétaire → délai de grâce ; retour → délai annulé.
 * `unlock(channel)` = unlockPrivateVoiceChannel (voice-commands.js).
 */
export function handlePrivateVoiceOwnerState(oldState, newState, { unlock, record = () => {}, graceMs = PRIVATE_RESET_GRACE_MS, schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  const guild = newState?.guild ?? oldState?.guild;
  if (!guild) return null;
  const memberId = newState?.id ?? oldState?.id;
  // Retour dans son salon : la réinitialisation prévue est annulée.
  if (newState?.channelId) {
    const pendingKey = `${guild.id}:${newState.channelId}`;
    const timer = timers.get(pendingKey);
    if (timer && timer.ownerId === memberId) {
      clearTimeout(timer.handle);
      timers.delete(pendingKey);
    }
  }
  const left = oldState?.channelId && oldState.channelId !== newState?.channelId ? oldState.channelId : null;
  if (!left) return null;
  const snapshot = getVoiceLockSnapshot(left);
  if (!snapshot || snapshot.ownerId !== memberId || isTempVoice(guild.id, left)) return null;
  const pendingKey = `${guild.id}:${left}`;
  if (timers.has(pendingKey)) clearTimeout(timers.get(pendingKey).handle);
  const handle = schedule(async () => {
    timers.delete(pendingKey);
    await resetIfAbandoned(guild, left, { unlock, record });
  }, graceMs);
  handle?.unref?.();
  timers.set(pendingKey, { handle, ownerId: memberId });
  return pendingKey;
}

/** Démarrage : tout salon privé dont le propriétaire est absent retrouve ses permissions. */
export async function resetAbandonedPrivateVoices(client, { unlock, isAllowedGuild = () => true, record = () => {} } = {}) {
  let reset = 0;
  for (const snapshot of listVoiceLockSnapshots()) {
    if (!isAllowedGuild(snapshot.guildId)) continue;
    const guild = client?.guilds?.cache?.get?.(snapshot.guildId);
    if (guild && await resetIfAbandoned(guild, snapshot.channelId, { unlock, record })) reset += 1;
  }
  return reset;
}

export function pendingPrivateResets() {
  return timers.size;
}
