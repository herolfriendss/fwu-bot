// SYS+ — /sysp annuler : l'owner défait sa dernière attribution de SYS+ dans l'heure qui suit (faute de frappe,
// mauvais membre). Seul le sens « moins de privilèges » : on retire le rôle, on ne redonne jamais rien.
import { listSysPlusAudit } from "./audit.js";

export const UNDO_WINDOW_MS = 3_600_000;

/** Dernière attribution faite par `actorId` dans la fenêtre, non déjà défaite ni suivie d'un retrait. */
export function lastUndoableGrant(guildId, actorId, now = Date.now()) {
  const rows = listSysPlusAudit(guildId, 50, { action: "sysplus.member." }).filter((r) => r.actorId === actorId);
  const grant = rows.find((r) => r.action === "sysplus.member.add" && now - r.createdAt <= UNDO_WINDOW_MS);
  if (!grant) return null;
  const later = listSysPlusAudit(guildId, 50, { memberId: grant.targetId, action: "sysplus.member." })
    .some((r) => r.id > grant.id && ["sysplus.member.remove", "sysplus.member.undo", "sysplus.member.expire"].includes(r.action));
  return later ? null : grant;
}
