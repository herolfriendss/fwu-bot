/**
 * Risky ACL detection (read-only, pure). Works on normalized data so it can
 * be unit-tested without Discord. Nothing here mutates the guild: findings
 * are reported to SYS+ who decide what to change.
 */
export const PERM = Object.freeze({
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  ViewAuditLog: 1n << 7n,
  ManageMessages: 1n << 13n,
  MentionEveryone: 1n << 17n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n,
  ModerateMembers: 1n << 40n,
});

const LABELS = Object.freeze({
  KickMembers: "Expulser",
  BanMembers: "Bannir",
  Administrator: "Administrateur",
  ManageChannels: "Gérer les salons",
  ManageGuild: "Gérer le serveur",
  ViewAuditLog: "Voir les logs",
  ManageMessages: "Gérer les messages",
  MentionEveryone: "Mentionner @everyone",
  MuteMembers: "Rendre muet",
  DeafenMembers: "Mettre en sourdine",
  MoveMembers: "Déplacer des membres",
  ManageNicknames: "Gérer les pseudos",
  ManageRoles: "Gérer les rôles / permissions",
  ManageWebhooks: "Gérer les webhooks",
  ManageGuildExpressions: "Gérer les expressions",
  ModerateMembers: "Exclure temporairement",
});

// Granting one of these to @everyone hands the server to anyone who joins.
const CRITICAL_FOR_EVERYONE = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageWebhooks",
  "BanMembers",
  "KickMembers",
];
const HIGH_FOR_EVERYONE = [
  "MentionEveryone",
  "ModerateMembers",
  "ManageMessages",
  "ManageNicknames",
  "MoveMembers",
  "MuteMembers",
  "DeafenMembers",
  "ViewAuditLog",
  "ManageGuildExpressions",
];
// In a channel overwrite, these allow escalation or mass abuse.
const RISKY_CHANNEL_ALLOWS = [
  "ManageChannels",
  "ManageRoles",
  "ManageWebhooks",
  "MentionEveryone",
  "ManageMessages",
];
const MODERATION_PERMS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "BanMembers",
  "KickMembers",
  "ModerateMembers",
  "ManageWebhooks",
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, info: 3 };

function toBits(value) {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

export function permissionNames(bits, names = Object.keys(PERM)) {
  const value = toBits(bits);
  return names.filter((name) => (value & PERM[name]) === PERM[name]);
}

export function labelPermissions(names) {
  return names.map((name) => LABELS[name] ?? name).join(", ");
}

/**
 * @param {object} input
 * @param {string} input.everyoneId
 * @param {Array<{id,name,position,managed,permissions,memberCount}>} input.roles
 * @param {Array<{id,name,overwrites:Array<{id,type,allow,deny}>}>} input.channels
 * @param {number} input.botPosition highest role position of the bot
 * @param {string|null} [input.sysPlusRoleId]
 * @param {string|null} [input.adminPlusRoleId]
 * @param {number} [input.adminHolderThreshold]
 */
export function analyzeGuildAcl({
  everyoneId,
  roles = [],
  channels = [],
  botPosition = 0,
  sysPlusRoleId = null,
  adminPlusRoleId = null,
  adminHolderThreshold = 5,
}) {
  const findings = [];
  const add = (severity, code, message, ref = {}) =>
    findings.push({ severity, code, message, ...ref });
  const everyone = roles.find((role) => role.id === everyoneId);

  if (everyone) {
    const critical = permissionNames(
      everyone.permissions,
      CRITICAL_FOR_EVERYONE,
    );
    if (critical.length)
      add(
        "critical",
        "everyone.dangerous",
        `@everyone possède : ${labelPermissions(critical)}.`,
        { roleId: everyoneId },
      );
    const high = permissionNames(everyone.permissions, HIGH_FOR_EVERYONE);
    if (high.length)
      add(
        "high",
        "everyone.sensitive",
        `@everyone possède : ${labelPermissions(high)}.`,
        { roleId: everyoneId },
      );
  }

  for (const role of roles) {
    if (role.id === everyoneId) continue;
    const perms = permissionNames(role.permissions, MODERATION_PERMS);
    if (!perms.length) continue;
    if (
      perms.includes("Administrator") &&
      !role.managed &&
      Number(role.memberCount ?? 0) > adminHolderThreshold
    ) {
      add(
        "high",
        "role.admin_many",
        `Le rôle « ${role.name} » donne Administrateur à ${role.memberCount} membres.`,
        { roleId: role.id },
      );
    }
    if (role.position >= botPosition && !role.managed) {
      add(
        "medium",
        "role.above_bot",
        `Le rôle « ${role.name} » (${labelPermissions(perms)}) est au-dessus du bot : ses membres échappent aux protections (DOG, MENOTTE, Anti-Move, GuildGuard).`,
        { roleId: role.id },
      );
    }
  }

  for (const [label, roleId] of [
    ["SYS+", sysPlusRoleId],
    ["ADMIN+", adminPlusRoleId],
  ]) {
    if (!roleId) continue;
    const role = roles.find((item) => item.id === roleId);
    if (!role)
      add(
        "medium",
        "tier.missing",
        `Le rôle ${label} configuré n'existe plus.`,
        { roleId },
      );
    else if (permissionNames(role.permissions, ["Administrator"]).length)
      add(
        "info",
        "tier.administrator",
        `Le rôle ${label} « ${role.name} » a la permission Administrateur : les contrôles fins de FWU deviennent sans effet face aux permissions natives.`,
        { roleId },
      );
  }

  for (const channel of channels) {
    for (const overwrite of channel.overwrites ?? []) {
      const allowed = permissionNames(overwrite.allow, RISKY_CHANNEL_ALLOWS);
      if (!allowed.length) continue;
      if (overwrite.id === everyoneId) {
        add(
          "high",
          "channel.everyone_allow",
          `#${channel.name} : @everyone autorisé à ${labelPermissions(allowed)}.`,
          { channelId: channel.id },
        );
      } else if (overwrite.type === 1) {
        add(
          "medium",
          "channel.member_allow",
          `#${channel.name} : un membre a une exception individuelle ${labelPermissions(allowed)}.`,
          { channelId: channel.id, memberId: overwrite.id },
        );
      }
    }
  }

  findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return findings;
}

/** Realtime: dangerous permissions a role update newly grants. */
export function newlyGrantedDangerous(beforeBits, afterBits) {
  const before = new Set(
    permissionNames(beforeBits, MODERATION_PERMS.concat(HIGH_FOR_EVERYONE)),
  );
  return permissionNames(
    afterBits,
    MODERATION_PERMS.concat(HIGH_FOR_EVERYONE),
  ).filter((name) => !before.has(name));
}

/** Realtime: risky allows a channel update newly grants to @everyone or a member. */
export function newlyRiskyOverwrites(
  beforeOverwrites,
  afterOverwrites,
  everyoneId,
) {
  const previous = new Map((beforeOverwrites ?? []).map((o) => [o.id, o]));
  const out = [];
  for (const overwrite of afterOverwrites ?? []) {
    if (overwrite.id !== everyoneId && overwrite.type !== 1) continue;
    const before = new Set(
      permissionNames(
        previous.get(overwrite.id)?.allow ?? 0n,
        RISKY_CHANNEL_ALLOWS,
      ),
    );
    const added = permissionNames(overwrite.allow, RISKY_CHANNEL_ALLOWS).filter(
      (name) => !before.has(name),
    );
    if (added.length)
      out.push({
        id: overwrite.id,
        everyone: overwrite.id === everyoneId,
        added,
      });
  }
  return out;
}

/** Normalizes a discord.js guild into analyzeGuildAcl input. */
export function normalizeGuildForAcl(
  guild,
  { sysPlusRoleId = null, adminPlusRoleId = null } = {},
) {
  const roles = [...(guild.roles?.cache?.values?.() ?? [])].map((role) => ({
    id: role.id,
    name: role.name,
    position: role.position,
    managed: Boolean(role.managed),
    permissions: role.permissions?.bitfield ?? 0n,
    memberCount: role.members?.size ?? 0,
  }));
  const channels = [...(guild.channels?.cache?.values?.() ?? [])]
    .filter((channel) => channel.permissionOverwrites?.cache)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      overwrites: [...channel.permissionOverwrites.cache.values()].map((o) => ({
        id: o.id,
        type: o.type,
        allow: o.allow?.bitfield ?? 0n,
        deny: o.deny?.bitfield ?? 0n,
      })),
    }));
  return {
    everyoneId: guild.id,
    roles,
    channels,
    botPosition: guild.members?.me?.roles?.highest?.position ?? 0,
    sysPlusRoleId,
    adminPlusRoleId,
  };
}

export function formatAclReport(findings, { limit = 15 } = {}) {
  if (!findings.length)
    return "✅ Aucune ACL risquée détectée par les règles de FWU.";
  const icon = { critical: "🟥", high: "🟧", medium: "🟨", info: "🟦" };
  const counts = Object.fromEntries(
    Object.keys(SEVERITY_ORDER).map((s) => [
      s,
      findings.filter((f) => f.severity === s).length,
    ]),
  );
  const lines = findings
    .slice(0, limit)
    .map((f) => `${icon[f.severity]} ${f.message}`);
  return [
    `**Audit ACL** — critique ${counts.critical} · élevé ${counts.high} · moyen ${counts.medium} · info ${counts.info}`,
    ...lines,
    findings.length > limit
      ? `… et ${findings.length - limit} autre(s).`
      : null,
    "Lecture seule : aucune permission n'a été modifiée.",
  ]
    .filter(Boolean)
    .join("\n");
}
