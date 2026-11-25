const SNOWFLAKE = /^\d{5,25}$/;
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export function isConfiguredPndOwner(actorId: unknown, configuredOwner: unknown): boolean {
  const actor = typeof actorId === "string" ? actorId.trim() : "";
  const owner = typeof configuredOwner === "string" ? configuredOwner.trim() : "";
  return SNOWFLAKE.test(actor) && SNOWFLAKE.test(owner) && actor === owner;
}

type GuildRolePermission = { id: string; permissions: string };
type GuildModuleSettingsActor = {
  guildId: string;
  actorId: string;
  guildOwnerId: string;
  memberRoleIds: string[];
  roles: GuildRolePermission[];
};

/**
 * Mirrors the setup panel's authorization rule using fresh Discord REST data:
 * guild owner, or a member whose guild roles grant ManageGuild/Administrator.
 * Channel overwrites cannot grant either guild-level permission.
 */
export function canConfigureGuildModuleSettings(input: GuildModuleSettingsActor): boolean {
  const { guildId, actorId, guildOwnerId, memberRoleIds, roles } = input;
  if (![guildId, actorId, guildOwnerId].every((id) => typeof id === "string" && SNOWFLAKE.test(id))) {
    return false;
  }
  if (actorId === guildOwnerId) return true;
  if (!Array.isArray(memberRoleIds) || !Array.isArray(roles)) return false;

  const heldRoleIds = new Set([guildId, ...memberRoleIds]);
  let permissions = 0n;
  for (const role of roles) {
    if (!role || !heldRoleIds.has(role.id)) continue;
    try {
      permissions |= BigInt(role.permissions);
    } catch {
      return false;
    }
  }
  return (permissions & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
}
