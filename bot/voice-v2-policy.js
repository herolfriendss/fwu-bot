// Her? V4 — Vocal V2 : règles pures des salons temporaires.
export function renderVoiceName(template, displayName) {
  const safe = String(displayName ?? "Membre").replace(/[\r\n\t]+/g, " ").trim().slice(0, 60) || "Membre";
  const rendered = String(template ?? "Salon de {user}").replaceAll("{user}", safe).replace(/[\r\n\t]+/g, " ").trim().slice(0, 100);
  return rendered || `Salon de ${safe}`;
}

export function clampVoiceLimit(raw) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, value));
}

export function canManageTempVoice({ ownerId, userId, hasManageChannels = false }) {
  if (!userId) return false;
  return userId === ownerId || Boolean(hasManageChannels);
}

export function tempVoiceNameIsValid(raw) {
  const name = String(raw ?? "").trim();
  return name.length >= 1 && name.length <= 100 && !/[\r\n\t]/.test(name);
}
