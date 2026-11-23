export const MAX_ACTIVE_LEASHES_PER_SYSPLUS = 3;
export const LEASH_ROLE_NAME = "En laisse";
export const LEGACY_LEASH_ROLE_NAMES = Object.freeze(["🐶 En laisse · Her?"]);

export async function findLeashRole(roleCache, botHighestPosition) {
  let role = roleCache.find((item) => item.name === LEASH_ROLE_NAME && !item.managed);
  if (!role) {
    role = roleCache.find((item) => LEGACY_LEASH_ROLE_NAMES.includes(item.name) && !item.managed);
    if (role) {
      if (role.position >= botHighestPosition) {
        throw new Error("Le rôle DOG doit être placé sous le rôle le plus élevé du bot.");
      }
      role = await role.setName(LEASH_ROLE_NAME, "Migration du rôle DOG vers FWU");
    }
  }
  if (role && role.position >= botHighestPosition) {
    throw new Error("Le rôle DOG doit être placé sous le rôle le plus élevé du bot.");
  }
  return role ?? null;
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
