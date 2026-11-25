export const CUSTOM_ROLE_LIMITS = Object.freeze({ perCreator: 1, perGuild: 25, minNameLength: 2, maxNameLength: 32 });

export function normalizeCustomRoleName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (name.length < CUSTOM_ROLE_LIMITS.minNameLength || name.length > CUSTOM_ROLE_LIMITS.maxNameLength) {
    throw new Error(`Le nom doit contenir entre ${CUSTOM_ROLE_LIMITS.minNameLength} et ${CUSTOM_ROLE_LIMITS.maxNameLength} caractères.`);
  }
  if (/@everyone|@here/i.test(name)) throw new Error("Les mentions @everyone et @here sont interdites dans un nom de rôle.");
  // « % » est réservé aux paliers (0 % intouchable, 1 %, 10 %…) : un rôle perso ne doit pas s'y faire passer.
  if (/[%％﹪٪]/u.test(name)) throw new Error("Le symbole % est réservé aux rôles de palier.");
  return name;
}

export function normalizeCustomRoleColor(value) {
  const color = String(value ?? "").trim();
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error("La couleur doit être au format hexadécimal #RRGGBB.");
  return color.toUpperCase();
}

export function customRoleQuotaDecision({ creatorCount, guildCount }) {
  if (Number(guildCount) >= CUSTOM_ROLE_LIMITS.perGuild) {
    return { allowed: false, reason: `La limite du serveur est atteinte (${CUSTOM_ROLE_LIMITS.perGuild} rôles personnalisés).` };
  }
  if (Number(creatorCount) >= CUSTOM_ROLE_LIMITS.perCreator) {
    return { allowed: false, reason: `Chaque créateur peut gérer au maximum ${CUSTOM_ROLE_LIMITS.perCreator} rôles personnalisés.` };
  }
  return { allowed: true, reason: null };
}

export function customRoleHierarchyDecision({ actorIsGuildOwner, actorPosition, botPosition, rolePosition, roleManaged, roleIsEveryone }) {
  if (roleIsEveryone || roleManaged) return { allowed: false, reason: "Ce rôle est protégé ou géré par une intégration." };
  if (Number(rolePosition) >= Number(botPosition)) return { allowed: false, reason: "Le rôle est au-dessus ou au même niveau que le rôle du bot." };
  if (!actorIsGuildOwner && Number(rolePosition) >= Number(actorPosition)) {
    return { allowed: false, reason: "Tu ne peux gérer que les rôles placés sous ton rôle le plus élevé." };
  }
  return { allowed: true, reason: null };
}
