import { authorize } from "../../platform/policy/authorize.js";
import { parsePndOwnerId } from "../../pnd-owner-policy.js";

const ADMINISTRATOR = 1n << 3n;

function hasAdministrator(member) {
  try {
    return Boolean(member?.permissions?.has?.(ADMINISTRATOR));
  } catch {
    return false;
  }
}

function memberTiers(member, sysPlusRoleId, adminPlusRoleId) {
  const tiers = [];
  const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (member?.id && ownerId === member.id) tiers.push("PND_OWNER", "SYS_PLUS", "ADMIN_PLUS");
  if (member?.id && member.guild?.ownerId === member.id) tiers.push("GUILD_OWNER");
  if (sysPlusRoleId && member?.roles?.cache?.has?.(sysPlusRoleId)) tiers.push("SYS_PLUS");
  if (adminPlusRoleId && member?.roles?.cache?.has?.(adminPlusRoleId)) tiers.push("ADMIN_PLUS");
  return [...new Set(tiers)];
}

function decide(member, { action, tiers, permissions = [], scope, enabledScopes = [] }) {
  const guildId = member?.guild?.id;
  if (!guildId || !member?.id) return false;
  const permissionSet = hasAdministrator(member) ? ["Administrator"] : [];
  return authorize({
    guildId,
    actor: { id: member.id },
    actionPolicy: {
      key: action,
      minTiers: tiers,
      requiredPermissions: permissions,
      ...(scope ? { scope } : {}),
    },
    resolved: {
      guildId,
      guildStatus: "active",
      moduleEnabled: true,
      tiers: memberTiers(member, null, null),
      permissions: permissionSet,
      adminScopes: enabledScopes,
    },
  }).allow;
}

/** SYS+ is an explicit entitlement; Discord Administrator does not grant SYS+ automatically. */
export function isSysPlus(member, roleId) {
  if (!member?.guild || !member.id) return false;
  return authorize({
    guildId: member.guild.id,
    actor: { id: member.id },
    actionPolicy: { key: "sysplus.access", minTiers: ["SYS_PLUS"] },
    resolved: {
      guildId: member.guild.id,
      guildStatus: "active",
      moduleEnabled: true,
      tiers: memberTiers(member, roleId, null),
    },
  }).allow;
}

/** ADMIN+ is deliberately limited: it never grants SYS+ configuration rights. */
export function isAdminPlus(member, sysPlusRoleId, adminPlusRoleId) {
  if (!member?.guild || !member.id) return false;
  return authorize({
    guildId: member.guild.id,
    actor: { id: member.id },
    actionPolicy: { key: "adminplus.access", minTiers: ["PND_OWNER", "ADMIN_PLUS"] },
    resolved: {
      guildId: member.guild.id,
      guildStatus: "active",
      moduleEnabled: true,
      tiers: memberTiers(member, sysPlusRoleId, adminPlusRoleId),
    },
  }).allow;
}

export function canConfigureSysPlus(member) {
  if (!member?.guild || !member.id) return false;
  return parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) === member.id;
}

export function canConfigureAdminPlus(member) {
  return canConfigureSysPlus(member);
}
