// Single source of truth for Discord permissions required by each FWU application.
// Keep this list aligned with src/lib/bot-profiles.ts and the bot feature ownership map.
export const PERMISSION_LABELS = Object.freeze({
  ManageMessages: "Gérer les messages",
  KickMembers: "Exclure",
  BanMembers: "Bannir",
  ModerateMembers: "Exclure temporairement",
  ManageRoles: "Gérer les rôles",
  ManageChannels: "Gérer les salons",
  ViewAuditLog: "Voir les logs",
  AddReactions: "Ajouter des réactions",
  Connect: "Se connecter",
  Speak: "Parler",
  MoveMembers: "Déplacer des membres",
  ManageNicknames: "Gérer les pseudos",
  ManageWebhooks: "Gérer les webhooks",
  MuteMembers: "Rendre muet",
  DeafenMembers: "Mettre en sourdine",
  SendMessages: "Envoyer des messages",
  EmbedLinks: "Intégrer des liens",
});

const permissions = {
  // Modération staff, sanctions temporaires, embeds, règlement et screening.
  fwu: ["SendMessages", "EmbedLinks", "ManageRoles", "ManageChannels", "ViewAuditLog", "ModerateMembers"],
  // Administration lourde, bans/kicks, anti-nuke, vérification et anti-spam.
  guard: ["ManageMessages", "KickMembers", "BanMembers", "ModerateMembers", "ManageRoles", "ManageChannels", "ViewAuditLog", "AddReactions"],
  // Musique, radio, salons vocaux temporaires, accès et déplacements.
  fdpdlavoc: ["Connect", "Speak", "MoveMembers", "ManageChannels", "ManageRoles", "SendMessages"],
  // SYS+, DOG, MENOTTE, LOCKNAME, rôles, tickets, automatisations et communauté.
  suckme: ["ManageRoles", "ManageNicknames", "MoveMembers", "ViewAuditLog", "ManageMessages", "ManageWebhooks", "MuteMembers", "DeafenMembers", "ModerateMembers", "BanMembers", "SendMessages", "ManageChannels"],
  // Économie PND, casino, jeux, cartes et transferts de rôles.
  fisc: ["ManageRoles", "SendMessages"],
  // Abonnements, salons privés, panneaux et rôles associés aux formules.
  investplus: ["ManageRoles", "ManageChannels", "SendMessages", "EmbedLinks"],
};

export const REQUIRED_PERMISSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(permissions).map(([profile, names]) => [profile, Object.freeze([...names])]),
  ),
);

// A missing critical permission means the bot cannot perform a central part of
// its advertised mission. Other missing permissions degrade only the affected
// features and remain warnings.
const critical = {
  fwu: ["ModerateMembers", "SendMessages"],
  guard: ["BanMembers", "KickMembers", "ManageMessages", "ModerateMembers"],
  fdpdlavoc: ["Connect", "Speak", "MoveMembers"],
  suckme: ["ManageRoles", "MoveMembers", "ManageNicknames", "ModerateMembers"],
  fisc: ["SendMessages"],
  investplus: ["ManageRoles", "ManageChannels", "SendMessages"],
};

export const CRITICAL_PERMISSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(critical).map(([profile, names]) => [profile, Object.freeze([...names])]),
  ),
);

export function requiredPermissionsForProfile(profile) {
  return REQUIRED_PERMISSIONS[profile] ?? REQUIRED_PERMISSIONS.fwu;
}

export function criticalPermissionsForProfile(profile) {
  return CRITICAL_PERMISSIONS[profile] ?? CRITICAL_PERMISSIONS.fwu;
}
