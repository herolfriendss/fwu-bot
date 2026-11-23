import { roleAssignmentDecision } from "./role-policy.js";

export function isConfiguredBotOwner(userId, ownerIds = []) {
  return (
    typeof userId === "string" &&
    Array.isArray(ownerIds) &&
    ownerIds.includes(userId)
  );
}

// Discord permission bits that must never be granted to everyone at once.
const DANGEROUS_PERMISSIONS = [
  ["Administrator", 1n << 3n],
  ["ManageGuild", 1n << 5n],
  ["ManageRoles", 1n << 28n],
  ["ManageChannels", 1n << 4n],
  ["ManageWebhooks", 1n << 29n],
  ["BanMembers", 1n << 2n],
  ["KickMembers", 1n << 1n],
  ["ModerateMembers", 1n << 40n],
  ["ManageMessages", 1n << 13n],
  ["MentionEveryone", 1n << 17n],
  ["ManageNicknames", 1n << 27n],
  ["ManageGuildExpressions", 1n << 30n],
  ["ManageEvents", 1n << 33n],
  ["ManageThreads", 1n << 34n],
  ["MoveMembers", 1n << 24n],
  ["MuteMembers", 1n << 22n],
  ["DeafenMembers", 1n << 23n],
  ["ViewAuditLog", 1n << 7n],
];

export function dangerousRolePermissions(role) {
  let bits;
  try {
    bits = BigInt(role?.permissions?.bitfield ?? role?.permissions ?? 0);
  } catch {
    return ["inconnues"];
  }
  return DANGEROUS_PERMISSIONS.filter(([, bit]) => (bits & bit) === bit).map(
    ([name]) => name,
  );
}

/** Pure plan: who would receive the role. Bots are always excluded. */
export function planRankAll({ members, role, guild, actor, botMember }) {
  const eligible = [];
  const skipped = [];
  let alreadyHolding = 0;
  let bots = 0;
  for (const member of members ?? []) {
    if (member.roles?.cache?.has(role.id)) {
      alreadyHolding += 1;
      continue;
    }
    if (member.user?.bot) {
      bots += 1;
      continue;
    }
    const decision = roleAssignmentDecision({
      actorId: actor.id,
      ownerId: guild.ownerId,
      targetId: member.id,
      actorPosition: actor.roles.highest.position,
      targetPosition: member.roles.highest.position,
      roleId: role.id,
      everyoneRoleId: guild.id,
      rolePosition: role.position,
      roleManaged: role.managed,
      botId: botMember.id,
      botPosition: botMember.roles.highest.position,
    });
    if (decision.allowed) eligible.push(member);
    else skipped.push({ id: member.id, reason: decision.reason });
  }
  return { eligible, skipped, alreadyHolding, bots };
}
