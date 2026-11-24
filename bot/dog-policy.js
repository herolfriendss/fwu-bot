export const MAX_ACTIVE_LEASHES_PER_SYSPLUS = 3;
// Décision du 24/11/2026 : un rôle par maître, « En laisse (Pseudo du maître) ».
// « En laisse » seul est l'ancien rôle commun : encore reconnu, migré au premier contrôle.
export const LEASH_ROLE_NAME = "En laisse";
export const LEGACY_LEASH_ROLE_NAMES = Object.freeze(["🐶 En laisse · Her?"]);
const OWNER_ROLE = /^En laisse \(.+\)$/u;
const ROLE_NAME_MAX = 100; // limite Discord

/** « En laisse (Pseudo) » : pseudo nettoyé, nom total ≤ 100 caractères. */
export function leashRoleName(ownerName) {
  const clean = String(ownerName ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "son maître";
  const room = ROLE_NAME_MAX - "En laisse ()".length;
  return `En laisse (${clean.length > room ? `${clean.slice(0, room - 1)}…` : clean})`;
}

/** Rôle de laisse (par maître, ancien rôle commun ou ancien nom). */
export function isLeashRoleName(name) {
  const value = String(name ?? "");
  return value === LEASH_ROLE_NAME || LEGACY_LEASH_ROLE_NAMES.includes(value) || OWNER_ROLE.test(value);
}

export function isOwnerLeashRoleName(name) {
  return OWNER_ROLE.test(String(name ?? ""));
}

/** Rôle « En laisse (Pseudo) » de ce maître s'il existe déjà (par son nom actuel). */
export function findLeashRole(roleCache, botHighestPosition, ownerName) {
  const role = roleCache.find((item) => item.name === leashRoleName(ownerName) && !item.managed) ?? null;
  if (role && role.position >= botHighestPosition) {
    throw new Error("Le rôle DOG doit être placé sous le rôle le plus élevé du bot.");
  }
  return role;
}

export function countActiveLeashesForOwner(records, guildId, ownerId) {
  return Object.values(records ?? {}).filter(
    (record) => record?.guildId === guildId && record?.ownerId === ownerId && !record?.releasing,
  ).length;
}

export function canCreateLeash(
  records,
  guildId,
  ownerId,
  maximum = MAX_ACTIVE_LEASHES_PER_SYSPLUS,
  whitelisted = false,
) {
  return whitelisted || countActiveLeashesForOwner(records, guildId, ownerId) < maximum;
}

export function leashQuotaStatus(
  records,
  guildId,
  ownerId,
  maximum = MAX_ACTIVE_LEASHES_PER_SYSPLUS,
  whitelisted = false,
) {
  const activeCount = countActiveLeashesForOwner(records, guildId, ownerId);
  const exceptionUsed = Boolean(whitelisted && activeCount >= maximum);
  return {
    activeCount,
    exceptionUsed,
    label: exceptionUsed
      ? `${activeCount + 1} (exception WHITELIST)`
      : `${activeCount + 1}/${maximum}`,
  };
}

export const MIN_CONFIGURABLE_LEASHES_PER_SYSPLUS = 1;
export const MAX_CONFIGURABLE_LEASHES_PER_SYSPLUS = 10;

/**
 * Returns the per-guild DOG leash limit. Only a stored integer within the
 * configurable bounds is accepted; anything else (missing, invalid, legacy)
 * falls back to the historical limit so existing guilds keep their behaviour.
 */
export function resolveMaxActiveLeashes(value) {
  if (
    Number.isInteger(value)
    && value >= MIN_CONFIGURABLE_LEASHES_PER_SYSPLUS
    && value <= MAX_CONFIGURABLE_LEASHES_PER_SYSPLUS
  ) {
    return value;
  }
  return MAX_ACTIVE_LEASHES_PER_SYSPLUS;
}
