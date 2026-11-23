export const MAX_WAOUF_DURATION_MINUTES = 1_440;
export const MAX_WAOUF_PHRASES = 20;
export const DEFAULT_WAOUF_PHRASES = Object.freeze([
  "Wouaf ! {membre}, tu es mon maître !",
  "Wouf ! Le salon est sous surveillance canine.",
]);

export function parseWaoufDuration(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_WAOUF_DURATION_MINUTES) {
    throw new Error("La durée WAOUF doit être comprise entre 1 et 1 440 minutes.");
  }
  return minutes;
}

export function sanitizeWaoufPhrase(value) {
  const phrase = String(value ?? "")
    .trim()
    .slice(0, 180);
  if (!phrase || /@[\u200b\s]*(?:everyone|here)/i.test(phrase)) {
    throw new Error("La phrase doit contenir du texte et ne peut pas viser @everyone ou @here.");
  }
  return phrase;
}

export function isWaoufExpired(expiresAt, now = Date.now()) {
  return Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0 && Number(expiresAt) <= now;
}

export function waoufResponse(deletedCount, repeatAfter, phrases, memberId) {
  if (deletedCount < repeatAfter) return "Wouaf !";
  const choices = Array.isArray(phrases) && phrases.length ? phrases : DEFAULT_WAOUF_PHRASES;
  const offset = Math.max(0, deletedCount - repeatAfter) % choices.length;
  return choices[offset].replaceAll("{membre}", `<@${memberId}>`);
}

/** Prefix every automated WAOUF response with the real author display name. */
export function formatWaoufAnnouncement(displayName, response) {
  const author = String(displayName ?? "Membre")
    .replace(/[@`*_~|>]/g, "\\$&")
    .trim()
    .slice(0, 80) || "Membre";
  return `**${author}** : ${String(response ?? "Wouaf !")}`;
}
