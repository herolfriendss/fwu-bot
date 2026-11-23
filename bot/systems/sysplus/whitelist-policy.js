import { authorize } from "../../platform/policy/authorize.js";

export const WHITELIST_ROLE_NAME = "WHITELIST";

export function canManageWhitelist(actorId, guildOwnerId, guildId = guildOwnerId) {
  if (!actorId || !guildOwnerId || !guildId) return false;
  return authorize({
    guildId,
    actor: { id: actorId },
    actionPolicy: { key: "whitelist.manage", minTiers: ["GUILD_OWNER"] },
    resolved: {
      guildId,
      guildStatus: "active",
      moduleEnabled: true,
      tiers: actorId === guildOwnerId ? ["GUILD_OWNER"] : [],
    },
  }).allow;
}

/** WHITELIST is a quota exemption only; it never grants member permissions. */
export function isWhitelistMember(member, whitelistRoleId) {
  if (!member?.guild || !whitelistRoleId) return false;
  return Boolean(member.roles?.cache?.has(whitelistRoleId));
}

export function isValidWhitelistRole(role, guildId, botHighestPosition) {
  return Boolean(
    role &&
    !role.managed &&
    role.id !== guildId &&
    role.name === WHITELIST_ROLE_NAME &&
    role.position < botHighestPosition,
  );
}
