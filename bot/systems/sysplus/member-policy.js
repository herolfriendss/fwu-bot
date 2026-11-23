import { roleAssignmentDecision } from "../../role-policy.js";

export function sysMemberActionDecision(input) {
  if (!input?.actorId || !input.ownerId || input.actorId !== input.ownerId) {
    return {
      allowed: false,
      reason: "Seul le propriétaire du serveur peut gérer les membres SYS+.",
    };
  }
  if (!input.hasManageRoles) {
    return { allowed: false, reason: "Le bot doit avoir la permission Gérer les rôles." };
  }
  return roleAssignmentDecision(input);
}
