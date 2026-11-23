/** Pure role hierarchy policy. All positions are Discord role positions. */
export function roleAssignmentDecision({ actorId, ownerId, targetId, actorPosition, targetPosition, roleId, everyoneRoleId, rolePosition, roleManaged, botId, botPosition }) {
  if (!actorId || !targetId || !roleId) return { allowed: false, reason: "Membre ou rôle introuvable." };
  if (roleId === everyoneRoleId || roleManaged) return { allowed: false, reason: "Ce rôle est protégé ou géré par une intégration." };
  if (targetId === ownerId) return { allowed: false, reason: "Le propriétaire du serveur ne peut pas être ciblé." };
  if (targetId === botId) return { allowed: false, reason: "Le bot ne peut pas modifier ses propres rôles." };
  if (rolePosition >= botPosition) return { allowed: false, reason: "Le rôle demandé est au-dessus ou au même niveau que le rôle du bot." };
  if (actorId !== ownerId && rolePosition >= actorPosition) return { allowed: false, reason: "Tu ne peux gérer que les rôles placés sous ton rôle le plus élevé." };
  if (actorId !== ownerId && targetPosition >= actorPosition) return { allowed: false, reason: "Tu ne peux modifier les rôles d'un membre placé au même niveau ou au-dessus de toi." };
  return { allowed: true, reason: null };
}
