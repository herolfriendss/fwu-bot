const MAX_MENOTTE_MS = 30 * 24 * 60 * 60 * 1000;

export function parseMenotteDuration(value) {
  if (value == null || value === "") return null;
  const match = String(value).trim().toLowerCase().match(/^(\d{1,5})(m|h|d)$/);
  if (!match) throw new Error("Durée invalide. Utilise un format comme `30m`, `2h` ou `3d` (maximum 30 jours).");
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration < 60_000 || duration > MAX_MENOTTE_MS) {
    throw new Error("La durée doit être comprise entre 1 minute et 30 jours.");
  }
  return duration;
}

export function isMenotteExpired(expiresAt, now = Date.now()) {
  return Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0 && Number(expiresAt) <= now;
}
