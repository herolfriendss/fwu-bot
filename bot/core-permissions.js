// FWU CORE 2.3 — service de décision des permissions (nouveaux modules et nouveaux bots).
//
// Une seule fonction, decide(), répond « autorisé ou non, et pourquoi » pour une action du
// catalogue. Elle compose les règles déjà en vigueur, sans les remplacer dans les modules
// existants (qui gardent leurs contrôles testés) :
//   • OWNER : uniquement l'ID configuré PND_OWNER_DISCORD_ID (jamais le propriétaire du serveur,
//     jamais une permission Administrateur à la place) ;
//   • SYS+ : rôle SYS+ configuré du serveur, par ID ;
//   • staff : membre de l'échelle (/staff echelle) ou SYS+ ;
//   • gel du staff (shared/freeze.js) : un membre gelé ne peut plus agir comme staff ;
//   • permissions Discord : exigées EN PLUS, jamais contournées ;
//   • dérogation AUTHORITY : consultée seulement si le contrôle normal refuse, seulement pour
//     les actions marquées « dérogeables », jamais pour une action OWNER, jamais pour l'OWNER
//     lui-même ni à la place d'une permission Discord.
// Refus par défaut : action inconnue, contexte incomplet ou erreur → refus expliqué.
import { parsePndOwnerId } from "./pnd-owner-policy.js";

export const LEVELS = Object.freeze(["member", "staff", "sysplus", "owner"]);

/** Catalogue fermé. exception: true = une dérogation AUTHORITY approuvée par l'OWNER peut l'ouvrir. */
export const ACTIONS = Object.freeze({
  "staff.center.view": { level: "staff" },
  "staff.intervention.manage": { level: "staff" },
  "staff.intervention.validate": { level: "sysplus" },
  "staff.mission.create": { level: "sysplus", exception: true },
  "staff.meeting.plan": { level: "sysplus", exception: true },
  "staff.training.certify": { level: "sysplus" },
  "authority.request": { level: "member" },
  "authority.decide": { level: "owner" },
  "core.queue.retry": { level: "owner" },
  "core.audit.export": { level: "owner" },
  "help.ask": { level: "member" },
  "economy.quota.extra": { level: "member", exception: true },
  "voice.room.extra": { level: "member", exception: true },
  "moderation.quota.extra": { level: "staff", exception: true },
  "module.beta.access": { level: "sysplus", exception: true },
});

const rank = (level) => LEVELS.indexOf(level);

/**
 * actor: { id, roleIds: Iterable<string>, hasDiscordPermission?: (flag) => boolean }
 * context: { settings, staffIds: Set|Array, env, isFrozen?: (id) => boolean,
 *            exception?: ({ action, actorId }) => boolean, discordPermission?: bigint|string }
 */
export function decide(actionName, actor, context = {}) {
  const action = ACTIONS[actionName];
  if (!action) return { allowed: false, reason: "Action inconnue : refusée par défaut." };
  if (!actor?.id) return { allowed: false, reason: "Auteur inconnu : refusé par défaut." };
  try {
    const env = context.env ?? process.env;
    const ownerId = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
    const roles = new Set(actor.roleIds ?? []);
    const sysPlusRole = context.settings?.sysPlus?.roleId ?? null;
    const staffIds = new Set(context.staffIds ?? []);
    const isOwner = Boolean(ownerId) && actor.id === ownerId;
    const isSysPlus = Boolean(sysPlusRole) && roles.has(sysPlusRole);
    const frozen = !isOwner && Boolean(context.isFrozen?.(actor.id));
    const level = isOwner ? "owner" : frozen ? "member" : isSysPlus ? "sysplus" : staffIds.has(actor.id) ? "staff" : "member";

    // Discord permissions are required in addition, for everyone but the configured OWNER's
    // application-level actions; an exception never replaces them.
    if (context.discordPermission && !isOwner && !actor.hasDiscordPermission?.(context.discordPermission)) {
      return { allowed: false, reason: "Permission Discord manquante : aucune dérogation ne peut la remplacer.", level };
    }
    if (rank(level) >= rank(action.level)) return { allowed: true, via: level, level };
    if (frozen && rank(action.level) >= rank("staff")) return { allowed: false, reason: "Ton accès staff est gelé.", level };
    if (action.exception && action.level !== "owner" && typeof context.exception === "function") {
      // The OWNER never receives an exception (they already decide); any error refuses.
      if (!isOwner && context.exception({ action: actionName, actorId: actor.id }) === true) return { allowed: true, via: "exception", level };
    }
    const need = { staff: "Réservé au staff.", sysplus: "Réservé aux SYS+ et à l'OWNER.", owner: "Réservé à l'OWNER." }[action.level] ?? "Accès refusé.";
    return { allowed: false, reason: need, level };
  } catch {
    return { allowed: false, reason: "Vérification impossible : refusé par sécurité." };
  }
}
