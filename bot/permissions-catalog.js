// Single source of truth for broad Discord permissions granted to FWU applications.
// Deliberately excludes Administrator: that permission bypasses channel overwrites and
// makes every compromised token equivalent to a server-wide superuser.
export const PERMISSION_LABELS = Object.freeze({
  ViewChannel: "Voir les salons",
  ManageChannels: "Gérer les salons",
  ManageRoles: "Gérer les rôles",
  ManageGuild: "Gérer le serveur",
  ViewAuditLog: "Voir les logs d'audit",
  ViewGuildInsights: "Voir les statistiques du serveur",
  ManageEvents: "Gérer les événements",
  CreateEvents: "Créer des événements",
  CreateInstantInvite: "Créer des invitations",
  KickMembers: "Exclure des membres",
  BanMembers: "Bannir des membres",
  ModerateMembers: "Exclure temporairement",
  ManageNicknames: "Gérer les pseudos",
  ChangeNickname: "Changer son pseudo",
  ManageMessages: "Gérer les messages",
  ReadMessageHistory: "Lire l'historique des messages",
  SendMessages: "Envoyer des messages",
  SendMessagesInThreads: "Envoyer dans les fils",
  CreatePublicThreads: "Créer des fils publics",
  CreatePrivateThreads: "Créer des fils privés",
  ManageThreads: "Gérer les fils",
  EmbedLinks: "Intégrer des liens",
  AttachFiles: "Joindre des fichiers",
  MentionEveryone: "Mentionner @everyone et les rôles",
  AddReactions: "Ajouter des réactions",
  UseExternalEmojis: "Utiliser les emojis externes",
  UseExternalStickers: "Utiliser les stickers externes",
  Connect: "Se connecter en vocal",
  Speak: "Parler en vocal",
  Stream: "Partager un écran",
  UseVAD: "Détection d'activité vocale",
  PrioritySpeaker: "Voix prioritaire",
  MuteMembers: "Rendre muet",
  DeafenMembers: "Mettre en sourdine",
  MoveMembers: "Déplacer des membres",
  ManageWebhooks: "Gérer les webhooks",
  ManageGuildExpressions: "Gérer les emojis et stickers",
  UseApplicationCommands: "Utiliser les commandes d'applications",
  UseExternalApps: "Utiliser les applications externes",
  SendPolls: "Envoyer des sondages",
  CreatePolls: "Créer des sondages",
  UseSoundboard: "Utiliser la table de mixage",
  UseExternalSounds: "Utiliser les sons externes",
  UseEmbeddedActivities: "Utiliser les activités intégrées",
});

const allOperationalPermissions = Object.freeze([
  "ViewChannel", "ManageChannels", "ManageRoles", "ManageGuild", "ViewAuditLog",
  "ViewGuildInsights", "ManageEvents", "CreateEvents", "CreateInstantInvite",
  "KickMembers", "BanMembers", "ModerateMembers", "ManageNicknames", "ChangeNickname",
  "ManageMessages", "ReadMessageHistory", "SendMessages", "SendMessagesInThreads",
  "CreatePublicThreads", "CreatePrivateThreads", "ManageThreads", "EmbedLinks",
  "AttachFiles", "MentionEveryone", "AddReactions", "UseExternalEmojis",
  "UseExternalStickers", "Connect", "Speak", "Stream", "UseVAD", "PrioritySpeaker",
  "MuteMembers", "DeafenMembers", "MoveMembers", "ManageWebhooks",
  "ManageGuildExpressions", "UseApplicationCommands", "UseExternalApps", "SendPolls",
  "CreatePolls", "UseSoundboard", "UseExternalSounds", "UseEmbeddedActivities",
]);

// All six apps receive the same broad operational capability set, so a stopped
// dedicated app can be safely replaced by FWU. Runtime ownership still restricts
// which application actually handles each command/domain.
const profiles = ["fwu", "guard", "fdpdlavoc", "suckme", "fisc", "investplus"];
const permissions = Object.fromEntries(
  profiles.map((profile) => [profile, allOperationalPermissions]),
);

export const REQUIRED_PERMISSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(permissions).map(([profile, names]) => [profile, Object.freeze([...names])]),
  ),
);

// These permissions are central to each application's advertised function.
const critical = {
  fwu: ["ManageRoles", "ManageChannels", "ViewAuditLog", "ModerateMembers", "SendMessages"],
  guard: ["BanMembers", "KickMembers", "ManageMessages", "ModerateMembers", "ViewAuditLog"],
  fdpdlavoc: ["Connect", "Speak", "MoveMembers", "ManageChannels"],
  suckme: ["ManageRoles", "MoveMembers", "ManageNicknames", "ModerateMembers", "ManageChannels"],
  fisc: ["ManageRoles", "SendMessages", "ManageChannels"],
  investplus: ["ManageRoles", "ManageChannels", "SendMessages", "EmbedLinks"],
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
