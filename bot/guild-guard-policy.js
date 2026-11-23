// Her? V4 — décisions GuildGuard sans dépendance Discord (testables partout).
// Toutes les fonctions sont pures et indexées par serveur par l’appelant.

/** Accepte une liste d’identifiants séparés par des virgules ou des espaces. */
export function parseGuildAllowlist(raw) {
  return [
    ...new Set(
      String(raw ?? "")
        .split(/[\s,;]+/)
        .filter((id) => /^\d{5,25}$/.test(id)),
    ),
  ].slice(0, 100);
}

/** Âge du compte Discord en jours (0 si la date est invalide ou future). */
export function accountAgeDays(createdAt, now = Date.now()) {
  const created =
    createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, (now - created) / 86_400_000);
}

/** Détecte une rafale de connexions dans la fenêtre configurée. */
export function raidTriggered(timestamps, now, windowMs, threshold) {
  if (!threshold || threshold <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) return false;
  const recent = timestamps.filter(
    (at) => Number.isFinite(at) && now - at >= 0 && now - at < windowMs,
  );
  return recent.length > threshold;
}

export function isQuarantineRoleAssignable(role, guildId, botHighestPosition, canManageRoles) {
  return Boolean(
    canManageRoles &&
    role &&
    !role.managed &&
    role.id !== guildId &&
    Number.isFinite(role.position) &&
    role.position < botHighestPosition,
  );
}

/**
 * Décide du sort d’un nouveau membre.
 * @returns {{ action: "allow" | "log" | "kick" | "quarantine", reason: string | null }}
 */
export function evaluateJoin({ createdAt, now = Date.now(), guard, raidMode = false }) {
  if (!guard?.enabled) return { action: "allow", reason: null };
  const action =
    guard.youngAccountAction === "kick"
      ? "kick"
      : guard.youngAccountAction === "quarantine" && guard.quarantineRoleId
        ? "quarantine"
        : "log";
  const minimum = Number(guard.minAccountAgeDays ?? 0);
  const isYoungAccount = minimum > 0 && accountAgeDays(createdAt, now) < minimum;
  if (guard.lockdown) return { action, reason: "lockdown" };
  // A join spike is an alert condition, not sufficient evidence to punish every
  // entrant. Keep automatic raid sanctions limited to accounts also failing the
  // configured age threshold, so an old member cannot be kicked by a raid burst.
  if (raidMode && isYoungAccount) return { action, reason: "raid" };
  if (isYoungAccount) return { action, reason: "young_account" };
  return { action: "allow", reason: null };
}

export function guardReason(reason, minimum) {
  if (reason === "lockdown") return "GuildGuard : serveur en confinement.";
  if (reason === "raid") return "GuildGuard : rafale de connexions détectée.";
  return `GuildGuard : compte créé depuis moins de ${minimum} jour(s).`;
}
