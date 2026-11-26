import {
  canConfigureSysPlus,
  isAdminPlus,
  isSysPlus,
} from "./systems/sysplus/permissions.js";
import { canUseAdminPlusScope } from "./systems/sysplus/admin-plus-scope-policy.js";
import { canManageWhitelist } from "./systems/sysplus/whitelist-policy.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

/**
 * Live permission matrix. Each cell is computed by calling the real policy
 * functions with a synthetic member of the given tier, so the matrix cannot
 * drift from the code. ADMIN+ cells reflect the guild's current scope toggles.
 */
export const MATRIX_TIERS = Object.freeze([
  { key: "owner", label: "OWNER" },
  { key: "guildOwner", label: "Propriétaire Discord" },
  { key: "sysplus", label: "SYS+" },
  { key: "adminplus", label: "ADMIN+" },
  { key: "whitelist", label: "WHITELIST" },
  { key: "administrator", label: "Admin Discord" },
  { key: "member", label: "Membre" },
]);

function syntheticMember(
  tier,
  {
    guildId,
    ownerId,
    guildOwnerId,
    sysPlusRoleId,
    adminPlusRoleId,
    whitelistRoleId,
  },
) {
  const ids = {
    owner: ownerId ?? "100000000000000001",
    guildOwner: guildOwnerId ?? "100000000000000002",
  };
  const id =
    ids[tier] ??
    `10000000000000099${MATRIX_TIERS.findIndex((t) => t.key === tier)}`;
  const roles = new Set();
  if (tier === "sysplus" && sysPlusRoleId) roles.add(sysPlusRoleId);
  if (tier === "adminplus" && adminPlusRoleId) roles.add(adminPlusRoleId);
  if (tier === "whitelist" && whitelistRoleId) roles.add(whitelistRoleId);
  const administrator = tier === "administrator";
  return {
    id,
    guild: { id: guildId, ownerId: guildOwnerId ?? ids.guildOwner },
    roles: { cache: { has: (roleId) => roles.has(roleId) } },
    permissions: {
      has: (perm) =>
        administrator &&
        (perm === 8n || perm === "Administrator" || perm === 1n << 3n),
    },
  };
}

export function buildPermissionMatrix({
  guildId,
  guildOwnerId,
  sysPlusRoleId = null,
  adminPlusRoleId = null,
  whitelistRoleId = null,
  scopes = {},
}) {
  const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  const ctx = {
    guildId,
    ownerId,
    guildOwnerId,
    sysPlusRoleId,
    adminPlusRoleId,
    whitelistRoleId,
  };
  const scope = (member, name) =>
    canUseAdminPlusScope(
      member,
      sysPlusRoleId,
      adminPlusRoleId,
      name,
      scopes[name] === true,
    );
  const actions = [
    {
      label: "rankall / =pnd add|remove|set / /pnd-add",
      check: (m) => Boolean(ownerId && m.id === ownerId),
    },
    {
      label: "Configurer SYS+ / ADMIN+ (/sysp role, admin-role, add, remove)",
      check: (m) => canConfigureSysPlus(m),
    },
    {
      label: "Gérer WHITELIST",
      check: (m) => canManageWhitelist(m.id, m.guild.ownerId, m.guild.id),
    },
    {
      label: "Centre SYS+, incidents, audit, diagnostics, Anti-Move",
      check: (m) => isSysPlus(m, sysPlusRoleId),
    },
    {
      label: "Espace ADMIN+",
      check: (m) => isAdminPlus(m, sysPlusRoleId, adminPlusRoleId),
    },
    {
      label: "Rôles : =rank, /rolepanel (scope roles)",
      check: (m) => scope(m, "roles"),
    },
    {
      label: "MENOTTE, WAKEUP, =pv liste (scope voice)",
      check: (m) => scope(m, "voice"),
    },
    { label: "LOCKNAME (scope lockname)", check: (m) => scope(m, "lockname") },
    {
      label: "Support / tickets (scope tickets)",
      check: (m) => scope(m, "tickets"),
    },
    {
      label: "Exemption des limites (spam, plafonds =pay)",
      check: (m) =>
        Boolean(whitelistRoleId && m.roles.cache.has(whitelistRoleId)),
    },
  ];
  const rows = actions.map((action) => ({
    label: action.label,
    cells: Object.fromEntries(
      MATRIX_TIERS.map((tier) => [
        tier.key,
        Boolean(action.check(syntheticMember(tier.key, ctx))),
      ]),
    ),
  }));
  return {
    tiers: MATRIX_TIERS,
    rows,
    configured: {
      owner: Boolean(ownerId),
      sysPlus: Boolean(sysPlusRoleId),
      adminPlus: Boolean(adminPlusRoleId),
      whitelist: Boolean(whitelistRoleId),
    },
  };
}

export function formatPermissionMatrix(matrix) {
  const header = matrix.tiers
    .map((tier, index) => `${index + 1}=${tier.label}`)
    .join(" · ");
  const lines = matrix.rows.map(
    (row) =>
      `${matrix.tiers.map((tier) => (row.cells[tier.key] ? "✅" : "▫️")).join("")} ${row.label}`,
  );
  const missing = Object.entries(matrix.configured)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  return [
    "**Matrice de permissions** (calculée depuis le code et les scopes ADMIN+ actuels)",
    `Colonnes : ${header}`,
    ...lines,
    missing.length ? `⚠️ Non configuré : ${missing.join(", ")}.` : null,
    "Les permissions natives Discord (Administrateur, hiérarchie) s'appliquent en plus et ne sont jamais contournées.",
  ]
    .filter(Boolean)
    .join("\n");
}
