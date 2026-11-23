import { authorize } from "../../platform/policy/authorize.js";

export const ADMIN_PLUS_SCOPES = Object.freeze({
  roles: { label: "Gestion des rôles", defaultEnabled: true },
  voice: { label: "Administration vocale et MENOTTE", defaultEnabled: true },
  lockname: { label: "LOCKNAME", defaultEnabled: true },
  tickets: { label: "Gestion du support", defaultEnabled: false },
});

export function canUseAdminPlusScope(member, sysPlusRoleId, adminPlusRoleId, scope, enabled) {
  if (!member?.guild?.id || !member.id || !ADMIN_PLUS_SCOPES[scope]) return false;
  // SYS+ is a feature entitlement, not an administrative role.
  // The configured PND Owner is the only unconditional bypass.
  const isPndOwner = member.id === (process.env.PND_OWNER_DISCORD_ID ?? "").trim();
  if (isPndOwner) return true;
  // Other members need the explicit ADMIN+ role and this scope enabled.
  if (!adminPlusRoleId || !member.roles?.cache?.has?.(adminPlusRoleId) || enabled !== true) return false;
  return authorize({
    guildId: member.guild.id,
    actor: { id: member.id },
    actionPolicy: { key: `adminplus.${scope}`, minTiers: ["PND_OWNER", "ADMIN_PLUS"], scope },
    resolved: {
      guildId: member.guild.id,
      guildStatus: "active",
      moduleEnabled: true,
      tiers: ["ADMIN_PLUS"],
      adminScopes: [scope],
    },
  }).allow;
}
