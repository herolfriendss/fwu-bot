import { authorize } from "./platform/policy/authorize.js";

const DISCORD_SNOWFLAKE = /^\d{5,25}$/;

/** PND has exactly one immutable bot owner. */
export function parsePndOwnerId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return DISCORD_SNOWFLAKE.test(id) ? id : null;
}

/** Legacy cofounder settings are intentionally ignored: only the configured owner is privileged. */
export function parsePndCofounderIds(_value, _ownerId = null) {
  return Object.freeze([]);
}

/** Compatibility helper: accepts one configured owner (or a one-item array), never a multi-owner list. */
export function parsePndOwnerIds(value) {
  const candidate = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  const owner = parsePndOwnerId(candidate);
  return owner ? [owner] : [];
}

export function getPndPrivilegedIds(ownerId, _legacyCofounderIds = null) {
  const owner = parsePndOwnerId(ownerId);
  return owner ? [owner] : [];
}

export function isConfiguredPndOwner(actorId, configuredOwner, guildId) {
  if (typeof guildId !== "string" || !guildId) return false;
  const owner = parsePndOwnerId(configuredOwner);
  return authorize({
    guildId,
    actor: { id: actorId },
    actionPolicy: { key: "pnd.owner.manage", minTiers: ["PND_OWNER"] },
    resolved: {
      guildId, guildStatus: "active", moduleEnabled: true,
      tiers: owner && owner === actorId ? ["PND_OWNER"] : [],
    },
  }).allow;
}
