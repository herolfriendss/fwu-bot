// Her? V4 — règles de modération pures, testables sans Discord.
// Aucune fonction ne lit la base : les décisions sont déterministes.

export function parseDuration(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  const match = /^(\\d+)\\s*(m|h|d|j)?$/.exec(text);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) return null;

  const unit = match[2] ?? "m";
  const minutes = unit === "h" ? value * 60 : unit === "d" || unit === "j" ? value * 1440 : value;
  if (!Number.isSafeInteger(minutes) || minutes > 40_320) return null;
  return minutes;
}

export function hasPermission(bitfield, bit) {
  try {
    return (BigInt(bitfield) & BigInt(bit)) === BigInt(bit);
  } catch {
    return false;
  }
}

/**
 * Vérifie la hiérarchie et les permissions avant une sanction.
 * @returns {{ allowed: boolean, reason: string | null }}
 */
export function canModerate({
  actorId, targetId, guildOwnerId, actorPermissions, targetPermissions = "0",
  actorPosition = 0, targetPosition = 0, botPosition = 0, requiredBit,
}) {
  if (!actorId || !targetId) return { allowed: false, reason: "Membre introuvable." };
  if (actorId === targetId) return { allowed: false, reason: "Tu ne peux pas t’appliquer cette action." };
  if (targetId === guildOwnerId) return { allowed: false, reason: "Le propriétaire du serveur est protégé." };
  if (actorId !== guildOwnerId && !hasPermission(actorPermissions, requiredBit)) {
    return { allowed: false, reason: "Permission Discord insuffisante." };
  }
  if (actorId !== guildOwnerId && hasPermission(targetPermissions, "8")) {
    return { allowed: false, reason: "Ce membre est administrateur." };
  }
  if (actorId !== guildOwnerId && actorPosition <= targetPosition) {
    return { allowed: false, reason: "Ton rôle doit être au-dessus de celui de ce membre." };
  }
  if (targetPosition >= botPosition) {
    return { allowed: false, reason: "Mon rôle doit être au-dessus de celui de ce membre." };
  }
  return { allowed: true, reason: null };
}

export function warningExpiry(now, days) {
  return days > 0 ? now + days * 86_400_000 : null;
}

export function activeWarnings(warnings, now = Date.now()) {
  return warnings.filter((warning) => !warning.expires_at || Number(warning.expires_at) > now);
}

export function verificationEligible(createdAt, now, minAccountAgeDays) {
  const created = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(created)) return { eligible: false, reason: "date de création inconnue" };
  const age = Math.max(0, now - created) / 86_400_000;
  if (minAccountAgeDays > 0 && age < minAccountAgeDays) {
    return { eligible: false, reason: `compte trop récent (${age.toFixed(1)} jour(s), minimum ${minAccountAgeDays})` };
  }
  return { eligible: true, reason: null };
}

export function sanitizeReason(raw, max = 300) {
  return String(raw ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max) || "Aucune raison fournie";
}

export function formatDuration(minutes) {
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} j`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h`;
  return `${minutes} min`;
}
