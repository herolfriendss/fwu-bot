const DISCORD_SNOWFLAKE = /^\d{5,25}$/;

export function isDiscordSnowflake(value) {
  return typeof value === "string" && DISCORD_SNOWFLAKE.test(value);
}

/**
 * A direct supervisor mapping must stay inside one guild, must not point to
 * itself, and must not create a cycle in the manager chain.
 */
export function staffSupervisorAssignmentDecision({
  guildId,
  staffUserId,
  supervisorUserId,
  guildOwnerId = null,
  existingRelations = [],
}) {
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(staffUserId) || !isDiscordSnowflake(supervisorUserId)) {
    return { allowed: false, reason: "Identifiants Discord invalides." };
  }
  if (staffUserId === supervisorUserId) {
    return { allowed: false, reason: "Un membre ne peut pas être son propre responsable." };
  }
  if (guildOwnerId && staffUserId === guildOwnerId) {
    return { allowed: false, reason: "Le propriétaire du serveur est au sommet de la hiérarchie." };
  }

  const parentByStaff = new Map();
  for (const relation of existingRelations) {
    if (isDiscordSnowflake(relation?.staff_user_id) && isDiscordSnowflake(relation?.supervisor_user_id)) {
      parentByStaff.set(relation.staff_user_id, relation.supervisor_user_id);
    }
  }
  // Evaluate the proposed graph, replacing any previous direct supervisor.
  parentByStaff.set(staffUserId, supervisorUserId);

  let cursor = supervisorUserId;
  const visited = new Set();
  while (cursor) {
    if (cursor === staffUserId) {
      return { allowed: false, reason: "Cette attribution créerait une boucle dans la hiérarchie." };
    }
    if (visited.has(cursor)) {
      return { allowed: false, reason: "La hiérarchie existante contient déjà une boucle. Corrige-la avant de continuer." };
    }
    visited.add(cursor);
    cursor = parentByStaff.get(cursor) ?? null;
  }

  return { allowed: true, reason: null };
}
