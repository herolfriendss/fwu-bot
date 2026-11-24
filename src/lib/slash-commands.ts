// Shared, client-safe definitions of the bot's slash commands (1942).
// No secrets here: imported by the panel UI, the interactions server module and
// the standalone Oracle bot. Keeping one list guarantees that the dashboard and
// the bot always register and document the exact same command surface.

export type SlashOptionChoice = { name: string; value: string | number };

export type SlashOption = {
  type: number; // 1 = SUB_COMMAND, 2 = SUB_COMMAND_GROUP, 3 = STRING, 4 = INTEGER, 5 = BOOLEAN, 6 = USER, 7 = CHANNEL, 8 = ROLE
  name: string;
  description: string;
  required?: boolean;
  max_length?: number;
  min_length?: number;
  min_value?: number;
  max_value?: number;
  channel_types?: number[];
  choices?: SlashOptionChoice[];
  options?: SlashOption[];
};

export type SlashCommandDef = {
  name: string;
  description: string;
  usage: string;
  category: string;
  options?: SlashOption[];
  defaultMemberPermissions?: string; // Discord permission bitfield as string
  dmPermission?: boolean;
  /** Informational: commands backed by the SQLite/Oracle bot need the gateway process. */
  requiresBotProcess?: boolean;
};

const opt = (type: number, name: string, description: string, extra: Partial<SlashOption> = {}): SlashOption => ({
  type,
  name,
  description,
  ...extra,
});

const sub = (name: string, description: string, options?: SlashOption[]): SlashOption => ({
  type: 1,
  name,
  description,
  ...(options?.length ? { options } : {}),
});

/** Discord limits: 25 options per command level, 100 top-level commands per application. */
export const DISCORD_MAX_OPTIONS = 25;
export const DISCORD_MAX_ROOT_COMMANDS = 100;

export type SubcommandLayoutEntry = string | { group: string; description: string; members: string[] };

/**
 * Layout of /sysp: some subcommands stay at the top level (the most used ones),
 * the others are nested in Discord subcommand groups (type 2). Every subcommand
 * must appear exactly once; groupSubcommands() throws at load time otherwise.
 */
export const SYSP_LAYOUT: SubcommandLayoutEntry[] = [
  "panel", "audit", "add", "remove", "permissions", "permissions-edit", "incident",
  { group: "config", description: "Rôles, ADMIN+ et PND Intelligence", members: ["role", "admin-role", "whitelist-role", "intelligence-channel", "intelligence-toggle"] },
  { group: "staff", description: "Responsables et hiérarchie du staff", members: ["supervisor-set", "supervisor-remove", "supervisor-list"] },
  { group: "whitelist", description: "Exemption WHITELIST (propriétaire)", members: ["whitelist-add", "whitelist-remove", "whitelist-list"] },
  { group: "outils", description: "Ghost, composer, recherche, blueprints, clone, studio, packs", members: ["ghost", "composer", "search", "blueprint", "clone", "studio", "pack"] },
  { group: "diagnostic", description: "Audit ACL, santé du bot et couverture des logs (lecture seule)", members: ["acl", "sante", "logs-couverture", "matrice", "economie", "bots"] },
  { group: "market", description: "Marketplace d'extensions (désactivé par défaut)", members: ["catalog", "installed", "publish", "withdraw", "submit", "validate", "reject", "install", "uninstall", "rollback"] },
];

/** Nests flat subcommands into Discord subcommand groups per the layout. Throws on any drift. */
export function groupSubcommands(flat: SlashOption[], layout: SubcommandLayoutEntry[]): SlashOption[] {
  const byName = new Map<string, SlashOption>();
  for (const option of flat) {
    if (option.type !== 1) throw new Error(`« ${option.name} » : seules les sous-commandes peuvent être regroupées.`);
    if (byName.has(option.name)) throw new Error(`Sous-commande en double : ${option.name}`);
    byName.set(option.name, option);
  }
  const used = new Set<string>();
  const take = (name: string): SlashOption => {
    const leaf = byName.get(name);
    if (!leaf) throw new Error(`Disposition : sous-commande inconnue « ${name} ».`);
    if (used.has(name)) throw new Error(`Disposition : « ${name} » est rangée deux fois.`);
    used.add(name);
    return leaf;
  };
  const out: SlashOption[] = [];
  for (const entry of layout) {
    if (typeof entry === "string") {
      out.push(take(entry));
      continue;
    }
    if (entry.members.length < 1 || entry.members.length > DISCORD_MAX_OPTIONS) throw new Error(`Groupe « ${entry.group} » : entre 1 et ${DISCORD_MAX_OPTIONS} sous-commandes.`);
    if (entry.description.length < 1 || entry.description.length > 100) throw new Error(`Groupe « ${entry.group} » : description de 1 à 100 caractères.`);
    out.push({ type: 2, name: entry.group, description: entry.description, options: entry.members.map(take) });
  }
  const missing = [...byName.keys()].filter((name) => !used.has(name));
  if (missing.length) throw new Error(`Sous-commandes non rangées : ${missing.join(", ")}`);
  if (out.length > DISCORD_MAX_OPTIONS) throw new Error(`Trop d'entrées au premier niveau (${out.length} / ${DISCORD_MAX_OPTIONS}).`);
  return out;
}

const manageServer = "32"; // MANAGE_GUILD
const manageMessages = "8192"; // MANAGE_MESSAGES
const moderateMembers = "1099511627776"; // MODERATE_MEMBERS
const kickMembers = "2"; // KICK_MEMBERS
const banMembers = "4"; // BAN_MEMBERS
const manageChannels = "16"; // MANAGE_CHANNELS

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // ── Général ────────────────────────────────────────────────────────────────
  { name: "aide", description: "Affiche la liste des commandes du bot", usage: "/aide", category: "Général" },
  {
    name: "ia", description: "Gère ta mémoire de conversation avec FWU", usage: "/ia memoire etat:activer|desactiver · /ia oublier", category: "Général", dmPermission: false, requiresBotProcess: true,
    options: [
      sub("memoire", "Choisis si FWU peut conserver le contexte de tes conversations", [
        opt(3, "etat", "Ton choix de consentement", { required: true, choices: [
          { name: "Activer la mémoire pour moi", value: "on" },
          { name: "Désactiver la mémoire pour moi", value: "off" },
        ] }),
      ]),
      sub("oublier", "Efface immédiatement tes conversations mémorisées sur ce serveur"),
      sub("demande", "PND Intelligence : demande une action (aperçu puis confirmation)", [
        opt(3, "texte", "Ta demande, ex. « crée un rôle Animateur »", { required: true, max_length: 1500 }),
      ]),
      sub("historique", "PND Intelligence : tes 10 dernières actions"),
    ],
  },
  { name: "status", description: "Affiche l’état du bot et sa durée de fonctionnement", usage: "/status", category: "Général" },
  {
    name: "sondage",
    description: "Crée un sondage dans ce salon",
    usage: "/sondage question option1 option2 …",
    category: "Général",
    options: [
      opt(3, "question", "La question du sondage", { required: true, max_length: 300 }),
      opt(3, "option_1", "Premier choix", { required: true, max_length: 55 }),
      opt(3, "option_2", "Deuxième choix", { required: true, max_length: 55 }),
      opt(3, "option_3", "Troisième choix (facultatif)", { max_length: 55 }),
      opt(3, "option_4", "Quatrième choix (facultatif)", { max_length: 55 }),
      opt(3, "option_5", "Cinquième choix (facultatif)", { max_length: 55 }),
    ],
  },
  {
    name: "nettoyer",
    description: "Supprime les derniers messages de ce salon",
    usage: "/nettoyer nombre",
    category: "Général",
    defaultMemberPermissions: manageMessages,
    dmPermission: false,
    options: [opt(4, "nombre", "Nombre de messages à supprimer (1–100)", { required: true, min_value: 1, max_value: 100 })],
  },

  // ── Sécurité ───────────────────────────────────────────────────────────────
  {
    name: "guildguard",
    description: "Configure GuildGuard : admission, anti-raid et confinement",
    usage: "/guildguard status | enable | disable | account-age | raid | quarantine | log | lockdown | review | resolve",
    category: "Administration & sécurité",
    defaultMemberPermissions: manageServer,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("status", "Affiche l’état de GuildGuard"),
      sub("enable", "Active GuildGuard"),
      sub("disable", "Désactive GuildGuard"),
      sub("account-age", "Âge minimal du compte Discord", [
        opt(4, "jours", "Nombre de jours requis (0 = désactivé)", { required: true, min_value: 0, max_value: 365 }),
      ]),
      sub("raid", "Seuil de détection des rafales de connexions", [
        opt(4, "connexions", "Connexions autorisées dans la fenêtre", { required: true, min_value: 0, max_value: 100 }),
        opt(4, "secondes", "Durée de la fenêtre en secondes", { required: true, min_value: 10, max_value: 600 }),
      ]),
      sub("quarantine", "Rôle attribué aux comptes suspects", [
        opt(8, "role", "Rôle de quarantaine", { required: true }),
      ]),
      sub("log", "Salon du journal GuildGuard", [
        opt(7, "salon", "Salon textuel", { required: true, channel_types: [0] }),
      ]),
      sub("lockdown", "Active ou désactive le confinement des nouvelles arrivées", [
        opt(3, "etat", "Nouvel état", { required: true, choices: [
          { name: "Activer", value: "on" },
          { name: "Désactiver", value: "off" },
        ] }),
      ]),
      sub("review", "Affiche les dossiers Guardian à examiner"),
      sub("resolve", "Clôt un dossier de revue humaine", [
        opt(4, "id", "Identifiant du dossier", { required: true, min_value: 1 }),
        opt(3, "decision", "Décision", { required: true, choices: [
          { name: "Examiné", value: "examined" },
          { name: "Classé sans suite", value: "cleared" },
        ] }),
        opt(3, "note", "Note interne facultative", { max_length: 300 }),
      ]),
    ],
  },
  // ── Modération ─────────────────────────────────────────────────────────────
  {
    name: "warn",
    description: "Avertit un membre et enregistre la raison",
    usage: "/warn membre raison [expire]",
    category: "Modération",
    defaultMemberPermissions: manageMessages,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à avertir", { required: true }),
      opt(3, "raison", "Raison de l’avertissement", { required: true, max_length: 300 }),
      opt(4, "expire", "Expiration en jours (0 = jamais)", { min_value: 0, max_value: 365 }),
    ],
  },
  {
    name: "warnings",
    description: "Affiche les avertissements actifs d’un membre",
    usage: "/warnings [membre]",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à consulter (par défaut : toi)")],
  },
  {
    name: "mute",
    description: "Met un membre en sourdine (timeout Discord)",
    usage: "/mute membre durée raison",
    category: "Modération",
    defaultMemberPermissions: moderateMembers,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à rendre muet", { required: true }),
      opt(3, "duree", "Durée : 10m, 2h, 1d…", { required: true, max_length: 20 }),
      opt(3, "raison", "Raison", { max_length: 300 }),
    ],
  },
  {
    name: "unmute",
    description: "Retire la sourdine d’un membre",
    usage: "/unmute membre [raison]",
    category: "Modération",
    defaultMemberPermissions: moderateMembers,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à rendre muet", { required: true }),
      opt(3, "raison", "Raison", { max_length: 300 }),
    ],
  },
  {
    name: "kick",
    description: "Expulse un membre du serveur",
    usage: "/kick membre raison",
    category: "Modération",
    defaultMemberPermissions: kickMembers,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à expulser", { required: true }),
      opt(3, "raison", "Raison", { required: true, max_length: 300 }),
    ],
  },
  {
    name: "ban",
    description: "Bannit un membre du serveur",
    usage: "/ban membre raison",
    category: "Modération",
    defaultMemberPermissions: banMembers,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à bannir", { required: true }),
      opt(3, "raison", "Raison", { required: true, max_length: 300 }),
    ],
  },
  {
    name: "purge",
    description: "Supprime des messages de ce salon",
    usage: "/purge nombre",
    category: "Modération",
    defaultMemberPermissions: manageMessages,
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "nombre", "Nombre de messages (1–100)", { required: true, min_value: 1, max_value: 100 })],
  },
  {
    name: "slowmode",
    description: "Règle le mode lent du salon",
    usage: "/slowmode secondes",
    category: "Modération",
    defaultMemberPermissions: manageMessages,
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "secondes", "Délai entre deux messages (0–21600)", { required: true, min_value: 0, max_value: 21600 })],
  },
  {
    name: "lock",
    description: "Verrouille le salon pour @everyone",
    usage: "/lock",
    category: "Modération",
    defaultMemberPermissions: manageChannels,
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "unlock",
    description: "Déverrouille le salon pour @everyone",
    usage: "/unlock",
    category: "Modération",
    defaultMemberPermissions: manageChannels,
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "verify",
    description: "Vérifie un membre ou publie le panneau de vérification",
    usage: "/verify moi | panel [salon] [role]",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("moi", "Te donner le rôle de vérification"),
      sub("panel", "Publie le panneau de vérification (et règle la vérification si tu choisis un rôle)", [
        opt(7, "salon", "Salon où publier le panneau", { channel_types: [0] }),
        opt(8, "role", "Rôle « Vérifié » donné après la vérification (active le module)"),
      ]),
      sub("reaction", "Vérification par réaction : publie le message dans un salon", [
        opt(7, "salon", "Salon d’accès", { required: true, channel_types: [0] }),
        opt(8, "role", "Rôle donné après réaction", { required: true }),
      ]),
      sub("reaction-off", "Désactive la vérification par réaction"),
    ],
  },
  {
    name: "removerole",
    description: "Retire un rôle à un membre (SYS+ / ADMIN+)",
    usage: "/removerole membre rôle",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à modifier", { required: true }),
      opt(8, "role", "Rôle à retirer", { required: true }),
    ],
  },
  {
    name: "rolepanel",
    description: "Panneau SYS+ de rôles personnalisés et gestion des rôles membres",
    usage: "/rolepanel panel | membre | create | rename | color | delete | list | manage",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Ouvre le panneau interactif des rôles personnalisés"),
      sub("membre", "Crée ou modifie le rôle perso d'un membre (nom, couleur)", [
        opt(6, "membre", "Membre concerné", { required: true }),
      ]),
      sub("manage", "Ouvre l'ancien panneau d'attribution de rôles aux membres"),
      sub("create", "Crée un rôle sans permissions Discord", [
        opt(3, "nom", "Nom (2 à 32 caractères)", { required: true, min_length: 2, max_length: 32 }),
        opt(3, "couleur", "Couleur hexadécimale #RRGGBB", { required: true, min_length: 7, max_length: 7 }),
      ]),
      sub("rename", "Renomme un rôle personnalisé", [
        opt(8, "role", "Rôle personnalisé", { required: true }),
        opt(3, "nom", "Nouveau nom (2 à 32 caractères)", { required: true, min_length: 2, max_length: 32 }),
      ]),
      sub("color", "Change la couleur d'un rôle personnalisé", [
        opt(8, "role", "Rôle personnalisé", { required: true }),
        opt(3, "couleur", "Couleur hexadécimale #RRGGBB", { required: true, min_length: 7, max_length: 7 }),
      ]),
      sub("delete", "Supprime un rôle personnalisé", [
        opt(8, "role", "Rôle personnalisé", { required: true }),
        opt(5, "confirmer", "Confirmer explicitement la suppression", { required: true }),
      ]),
      sub("list", "Liste les rôles personnalisés du serveur"),
    ],
  },
  {
    name: "rank",
    description: "Attribue un rôle à un membre (SYS+ / ADMIN+)",
    usage: "/rank membre rôle",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à promouvoir", { required: true }),
      opt(8, "role", "Rôle à attribuer", { required: true }),
    ],
  },
  {
    name: "rankall",
    description: "Attribue un rôle à tous les membres éligibles (propriétaires du bot uniquement)",
    usage: "/rankall role",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(8, "role", "Rôle à attribuer à tous les membres éligibles", { required: true })],
  },
  {
    name: "sysp",
    description: "Gestion du système SYS+",
    usage: "/sysp panel|audit|role|add|remove|permissions|whitelist-*|supervisor-*|diagnostic acl|sante|logs-couverture|matrice|economie|bots",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: groupSubcommands([
      sub("panel", "Ouvre le centre de contrôle SYS+"),
      sub("audit", "Affiche les dernières actions staff"),
      sub("role", "Configure le rôle Perm SYS+", [opt(8, "role", "Rôle à attribuer comme Perm SYS+", { required: true })]),
      sub("admin-role", "Configure le rôle ADMIN+ (permissions administratives limitées)", [opt(8, "role", "Rôle à attribuer comme ADMIN+", { required: true })]),
      sub("whitelist-role", "Configure le rôle exact WHITELIST (propriétaire uniquement)", [opt(8, "role", "Rôle nommé WHITELIST", { required: true })]),
      sub("intelligence-channel", "Configure le salon réservé à PND Intelligence", [opt(7, "salon", "Salon texte réservé à PND Intelligence", { required: true, channel_types: [0] })]),
      sub("intelligence-toggle", "Active ou désactive PND Intelligence", [opt(5, "etat", "Vrai = actif, faux = désactivé", { required: true })]),
      sub("supervisor-set", "Assigne un responsable direct à un membre du staff", [
        opt(6, "membre", "Modérateur ou membre du staff", { required: true }),
        opt(6, "responsable", "Chef ou superviseur en charge", { required: true }),
      ]),
      sub("supervisor-remove", "Retire le responsable direct d'un membre du staff", [
        opt(6, "membre", "Modérateur ou membre du staff", { required: true }),
      ]),
      sub("supervisor-list", "Affiche la hiérarchie des responsables configurés"),
      sub("ghost", "Ghost Mode : consultation staff privée et non intrusive"),
      sub("composer", "Command Composer : gérer les procédures staff réutilisables", [
        opt(3, "action", "Opération", { required: true, choices: [{ name: "Créer", value: "create" }, { name: "Lister", value: "list" }, { name: "Consulter", value: "show" }, { name: "Supprimer", value: "delete" }] }),
        opt(3, "nom", "Nom du runbook", { max_length: 40 }),
        opt(3, "description", "Description", { max_length: 180 }),
        opt(3, "contenu", "Procédure documentée", { max_length: 6000 }),
      ]),
      sub("search", "Smart Search : recherche dans les données SYS+ du serveur", [
        opt(3, "requete", "Termes à rechercher", { required: true, max_length: 120 }),
      ]),
      sub("incident", "Centre de gestion des incidents SYS+", [
        opt(3, "action", "Opération", { required: true, choices: [{ name: "Créer", value: "create" }, { name: "Lister", value: "list" }, { name: "Consulter", value: "show" }, { name: "Assigner", value: "assign" }, { name: "Résoudre", value: "resolve" }, { name: "Changer le statut", value: "status" }, { name: "Rapport (Markdown)", value: "report" }] }),
        opt(3, "titre", "Titre (création)", { max_length: 100 }),
        opt(3, "resume", "Résumé (création)", { max_length: 1500 }),
        opt(3, "gravite", "Gravité (création)", { choices: [{ name: "Faible", value: "low" }, { name: "Moyenne", value: "medium" }, { name: "Élevée", value: "high" }, { name: "Critique", value: "critical" }] }),
        opt(3, "id", "Identifiant incident (action)", { max_length: 36 }),
        opt(6, "membre", "Responsable (assignation)"),
        opt(3, "resolution", "Résolution (fermeture)", { max_length: 1500 }),
        opt(3, "statut", "Statut", { choices: [{ name: "Ouvert", value: "open" }, { name: "En cours", value: "in_progress" }] }),
      ]),
      sub("studio", "Creator Studio : annonces, stories, événements, validation et planification", [
        opt(3, "action", "Action à effectuer", { required: true, choices: [
          { name: "create", value: "create" },
          { name: "edit", value: "edit" },
          { name: "submit", value: "submit" },
          { name: "approve", value: "approve" },
          { name: "reject", value: "reject" },
          { name: "schedule", value: "schedule" },
          { name: "cancel", value: "cancel" },
          { name: "publish", value: "publish" },
          { name: "preview", value: "preview" },
          { name: "list", value: "list" },
          { name: "fav", value: "fav" },
          { name: "history", value: "history" },
          { name: "template-save", value: "template-save" },
          { name: "template-use", value: "template-use" },
          { name: "templates", value: "templates" },
        ] }),
        opt(3, "type", "Type de publication (création)", { choices: [
          { name: "Annonce", value: "announcement" },
          { name: "Story", value: "story" },
          { name: "Événement", value: "event" },
        ] }),
        opt(3, "id", "Identifiant du brouillon (au moins 4 caractères)", { max_length: 36 }),
        opt(3, "titre", "Titre (2 à 256 caractères)", { max_length: 256 }),
        opt(3, "contenu", "Contenu (4000 caractères max)", { max_length: 4000 }),
        opt(3, "couleur", "Couleur hexadécimale, ex. #7C3AED", { max_length: 8 }),
        opt(3, "image", "Image https (optionnel)", { max_length: 500 }),
        opt(3, "note", "Note de relecture ou raison de refus", { max_length: 300 }),
        opt(4, "minutes", "Délai avant publication (1 à 525600 minutes)"),
        opt(7, "salon", "Salon de publication", { channel_types: [0] }),
        opt(3, "modele", "Nom du modèle", { max_length: 40 }),
        opt(3, "mentions", "Membres à mentionner (identifiants séparés par des espaces)", { max_length: 300 }),
      ]),
      sub("pack", "Packs premium du serveur : attribuer, révoquer ou lister (propriétaires PND)", [
        opt(3, "action", "Action à effectuer", { required: true, choices: [
          { name: "Attribuer (grant)", value: "grant" },
          { name: "Révoquer (revoke)", value: "revoke" },
          { name: "Lister (list)", value: "list" },
        ] }),
        opt(3, "pack", "Pack premium (pour grant)", { choices: [
          { name: "ai.advanced", value: "ai.advanced" },
          { name: "automation.advanced", value: "automation.advanced" },
          { name: "analytics.advanced", value: "analytics.advanced" },
          { name: "commands.exclusive", value: "commands.exclusive" },
          { name: "creator.studio", value: "creator.studio" },
          { name: "server.tools", value: "server.tools" },
          { name: "social.advanced", value: "social.advanced" },
          { name: "economy.advanced", value: "economy.advanced" },
          { name: "games.premium", value: "games.premium" },
          { name: "studio.personal", value: "studio.personal" },
          { name: "cloud", value: "cloud" },
          { name: "marketplace", value: "marketplace" },
          { name: "extensions", value: "extensions" },
          { name: "lab", value: "lab" },
        ] }),
        opt(4, "jours", "Durée en jours 1 à 730 ; vide = sans expiration (grant)"),
        opt(4, "id", "Identifiant de l'attribution (revoke)"),
        opt(3, "note", "Note interne, 200 caractères max (grant)"),
      ]),
      sub("clone", "Server Clone : aperçu ou restauration additive d'un blueprint", [
        opt(3, "action", "Aperçu (plan) ou application (apply)", { required: true, choices: [
          { name: "Aperçu (plan)", value: "plan" },
          { name: "Appliquer (apply)", value: "apply" },
        ] }),
        opt(3, "blueprint", "Identifiant du blueprint (au moins 4 caractères)", { required: true }),
        opt(3, "jeton", "Jeton du plan (obligatoire pour apply)"),
      ]),
      sub("blueprint", "Time Machine : sauvegarde ou compare la structure du serveur", [
        opt(3, "action", "Opération", { required: true, choices: [{ name: "Créer une sauvegarde", value: "create" }, { name: "Lister les sauvegardes", value: "list" }, { name: "Comparer avec le serveur actuel", value: "compare" }, { name: "Exporter en JSON", value: "export" }] }),
        opt(3, "nom", "Nom de la sauvegarde (pour créer)", { max_length: 80 }),
        opt(3, "id", "Identifiant de sauvegarde (pour comparer)", { max_length: 36 }),
      ]),
      sub("acl", "Détecte les permissions et overwrites risqués (lecture seule)"),
      sub("sante", "État de santé du bot : Gateway, permissions, base, logs"),
      sub("logs-couverture", "Matrice de couverture des événements du Logs Hub"),
      sub("matrice", "Matrice des permissions par niveau (calculée depuis le code)"),
      sub("economie", "Intégrité du grand livre PND et signaux de fraude"),
      sub("bots", "Bots FWU : quel bot traite chaque domaine en ce moment"),
      sub("add", "Attribue le rôle SYS+ à un membre (propriétaire)", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("remove", "Retire le rôle SYS+ à un membre (propriétaire)", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("permissions", "Consulte les scopes ADMIN+"),
      sub("permissions-edit", "Modifie un scope ADMIN+", [
        opt(3, "module", "Module à configurer", { required: true, choices: [
          { name: "Gestion des rôles", value: "roles" }, { name: "Administration vocale et MENOTTE", value: "voice" },
          { name: "LOCKNAME", value: "lockname" }, { name: "Gestion du support", value: "tickets" },
        ] }),
        opt(5, "autorise", "Autoriser ADMIN+ sur ce module", { required: true }),
      ]),
      sub("whitelist-add", "Attribue WHITELIST (propriétaire)", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("whitelist-remove", "Retire WHITELIST (propriétaire)", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("whitelist-list", "Liste les membres WHITELIST (propriétaire)"),
      sub("catalog", "Catalogue du Marketplace (lecture)"),
      sub("installed", "Extensions installées sur ce serveur"),
      sub("publish", "Propriétaires : ajouter une extension au catalogue", [
        opt(3, "id", "Identifiant slug (3 à 40 caractères)", { required: true, max_length: 40 }),
        opt(3, "nom", "Nom affiché", { required: true, max_length: 80 }),
        opt(3, "resume", "Résumé court", { max_length: 200 }),
      ]),
      sub("withdraw", "Propriétaires : retirer une extension du catalogue", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
      ]),
      sub("submit", "Propriétaires : soumettre un manifeste JSON à revue", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
        opt(3, "manifeste", "Manifeste JSON déclaratif (16 Ko maximum)", { required: true, max_length: 6000 }),
      ]),
      sub("validate", "Propriétaires : valider une version en revue", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
        opt(3, "version", "Version x.y.z", { required: true, max_length: 12 }),
      ]),
      sub("reject", "Propriétaires : rejeter une version en revue", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
        opt(3, "version", "Version x.y.z", { required: true, max_length: 12 }),
      ]),
      sub("install", "Installe une version validée (consentement requis)", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
        opt(3, "version", "Version x.y.z", { required: true, max_length: 12 }),
        opt(5, "confirmer", "Vrai pour accepter les permissions affichées"),
      ]),
      sub("uninstall", "Désinstalle une extension (historique conservé)", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
      ]),
      sub("rollback", "Revient à la version précédente (sans élargir les permissions)", [
        opt(3, "id", "Identifiant de l'extension", { required: true, max_length: 40 }),
      ]),
    ], SYSP_LAYOUT),
  },
  {
    name: "ticket",
    description: "Gère les tickets de support",
    usage: "/ticket panel | close | add | remove | list | assign | historique | transcript",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Publie le panneau d’ouverture de tickets"),
      sub("close", "Ferme le ticket du salon courant", [
        opt(3, "raison", "Raison de la fermeture", { max_length: 300 }),
      ]),
      sub("add", "Ajoute un membre au ticket courant", [
        opt(6, "membre", "Membre à ajouter", { required: true }),
      ]),
      sub("remove", "Retire un membre du ticket courant", [
        opt(6, "membre", "Membre à retirer", { required: true }),
      ]),
      sub("list", "Liste les tickets du serveur"),
      sub("assign", "Assigne le ticket courant à un membre du staff", [
        opt(6, "membre", "Membre du staff support", { required: true }),
      ]),
      sub("historique", "Historique (métadonnées) d’un ticket", [
        opt(4, "id", "Identifiant du ticket (sinon le ticket courant)", { min_value: 1 }),
      ]),
      sub("transcript", "Transcription d’un ticket fermé (si activée)", [
        opt(4, "id", "Identifiant du ticket (sinon le ticket courant)", { min_value: 1 }),
      ]),
    ],
  },

  {
    name: "webhook",
    description: "Gère les webhooks et les publications automatiques",
    usage: "/webhook create | list | delete | publish | edit | animation",
    category: "Automatisation",
    // Runtime checks in bot/webhooks.js enforce SYS+/owner/admin. Do not hide
    // the command behind MANAGE_GUILD: a configured SYS+ role may lack it.
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("create", "Crée un webhook sécurisé dans un salon", [
        opt(7, "salon", "Salon textuel", { required: true, channel_types: [0] }),
        opt(3, "nom", "Nom du webhook", { required: true, max_length: 80 }),
      ]),
      sub("list", "Liste les webhooks gérés par FWU"),
      sub("delete", "Supprime un webhook géré", [
        opt(3, "id", "Identifiant du webhook", { required: true, max_length: 25 }),
      ]),
      sub("publish", "Publie un message via un webhook", [
        opt(3, "id", "Identifiant du webhook", { required: true, max_length: 25 }),
        opt(3, "message", "Contenu à publier", { required: true, max_length: 2000 }),
      ]),
      sub("edit", "Modifie le dernier message publié", [
        opt(3, "id", "Identifiant du webhook", { required: true, max_length: 25 }),
        opt(3, "message", "Nouveau contenu", { required: true, max_length: 2000 }),
      ]),
      sub("animation", "Active ou désactive l'animation des publications (tous ou un webhook)", [
        opt(3, "etat", "État de l'animation", { required: true, choices: [
          { name: "Activer", value: "on" },
          { name: "Désactiver", value: "off" },
        ] }),
        opt(3, "id", "ID du webhook (facultatif : sinon tous)", { max_length: 25 }),
      ]),
    ],
  },

  {
    name: "automation",
    description: "Configure les rôles automatiques, MP de bienvenue et messages planifiés",
    usage: "/automation status | autorole | welcome | schedule",
    category: "Automatisation",
    defaultMemberPermissions: manageServer,
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("status", "Affiche la configuration d’automatisation"),
      sub("autorole-add", "Ajoute un rôle automatique à l’arrivée", [
        opt(8, "role", "Rôle à attribuer", { required: true }),
      ]),
      sub("autorole-remove", "Retire un rôle automatique", [
        opt(8, "role", "Rôle à retirer", { required: true }),
      ]),
      sub("autorole-list", "Liste les rôles automatiques"),
      sub("welcome", "Active ou désactive le MP de bienvenue", [
        opt(3, "etat", "Nouvel état", { required: true, choices: [
          { name: "Activer", value: "on" },
          { name: "Désactiver", value: "off" },
        ] }),
        opt(3, "message", "Message personnalisé ({user}, {server})", { max_length: 2000 }),
      ]),
      sub("schedule-add", "Planifie un message récurrent", [
        opt(7, "salon", "Salon d’envoi", { required: true, channel_types: [0] }),
        opt(4, "intervalle", "Intervalle en minutes (5–10080)", { required: true, min_value: 5, max_value: 10080 }),
        opt(3, "message", "Message à envoyer", { required: true, max_length: 2000 }),
      ]),
      sub("schedule-remove", "Supprime un message planifié", [
        opt(4, "id", "Identifiant du message planifié", { required: true, min_value: 1 }),
      ]),
      { type: 2, name: "regles", description: "Règles d’automatisation avec validation du staff", options: [
        sub("salon", "Salon où le staff valide les déclenchements", [opt(7, "salon", "Salon de validation", { required: true, channel_types: [0] })]),
        sub("creer", "Crée une règle (aperçu puis confirmation staff à chaque déclenchement)", [
          opt(3, "declencheur", "Quand la règle se déclenche", { required: true, choices: [
            { name: "Arrivée d’un membre", value: "member_join" }, { name: "Départ d’un membre", value: "member_leave" },
            { name: "Message envoyé", value: "message_created" }, { name: "Entrée en vocal", value: "voice_join" },
            { name: "Sortie de vocal", value: "voice_leave" }, { name: "Planifiée", value: "scheduled" },
          ] }),
          opt(3, "nom", "Nom de la règle", { required: true, max_length: 80 }),
          opt(3, "action", "Ce que fait la règle", { required: true, choices: [
            { name: "Envoyer un message", value: "message" }, { name: "Ajouter un rôle", value: "add-role" }, { name: "Retirer un rôle", value: "remove-role" },
          ] }),
          opt(7, "salon", "Salon du message (action « message »)", { channel_types: [0] }),
          opt(3, "texte", "Texte du message (action « message »)", { max_length: 1500 }),
          opt(8, "role", "Rôle (actions sur les rôles)"),
          opt(4, "intervalle", "Minutes entre deux déclenchements (planifiée, 60 minimum)", { min_value: 60, max_value: 10080 }),
        ]),
        sub("liste", "Liste les règles"),
        sub("desactiver", "Désactive une règle", [opt(3, "id", "Identifiant de la règle", { required: true, max_length: 36 })]),
        sub("confirmer", "Confirme un déclenchement en attente", [opt(3, "run", "Identifiant du déclenchement", { required: true, max_length: 36 })]),
      ] },
      sub("schedule-list", "Liste les messages planifiés"),
    ],
  },

  // ── Économie PND ───────────────────────────────────────────────────────────
  {
    name: "balance",
    description: "Affiche ton solde PND ou celui d’un membre",
    usage: "/balance [membre]",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre dont afficher le solde")],
  },
  {
    name: "daily",
    description: "Récupère ton bonus quotidien PND",
    usage: "/daily",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "work",
    description: "Travaille pour gagner des PND (toutes les heures)",
    usage: "/work",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "job",
    description: "Choisis et suis ton métier PND sur ce serveur",
    usage: "/job list | status | choose métier",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("list", "Affiche les métiers disponibles"),
      sub("status", "Affiche ton métier et ta progression"),
      sub("choose", "Choisis ou changes de métier", [
        opt(3, "metier", "Métier choisi", {
          required: true,
          choices: [
            { name: "Artisane", value: "artisan" },
            { name: "Explorateur", value: "explorer" },
            { name: "Hôte communautaire", value: "host" },
            { name: "Mécanicien", value: "mechanic" },
            { name: "Coursier", value: "courier" },
          ],
        }),
      ]),
      opt(2, "mission", "Consulte et réclame tes missions quotidiennes", {
        options: [
          sub("status", "Affiche ta progression du jour"),
          sub("claim", "Réclame les récompenses terminées"),
        ],
      }),
      opt(2, "contract", "Crée et réalise des contrats communautaires avec escrow PND", {
        options: [
          sub("create", "Publie une mission rémunérée", [
            opt(3, "titre", "Titre du contrat", { required: true, max_length: 80 }),
            opt(3, "description", "Travail demandé", { required: true, max_length: 500 }),
            opt(4, "recompense", "Récompense réservée en PND", { required: true, min_value: 1, max_value: 1_000_000_000 }),
          ]),
          sub("list", "Consulte les contrats de ce serveur", [
            opt(3, "etat", "État à afficher", { choices: [
              { name: "Ouverts", value: "open" }, { name: "En cours", value: "claimed" },
              { name: "À valider", value: "submitted" }, { name: "Terminés", value: "completed" },
              { name: "Tous", value: "all" },
            ] }),
          ]),
          sub("claim", "Réclame un contrat ouvert", [opt(4, "id", "Identifiant du contrat", { required: true, min_value: 1 })]),
          sub("submit", "Soumets le compte rendu du travail", [
            opt(4, "id", "Identifiant du contrat", { required: true, min_value: 1 }),
            opt(3, "compte-rendu", "Compte rendu à valider", { required: true, max_length: 500 }),
          ]),
          sub("approve", "Valide un compte rendu et libère la récompense", [opt(4, "id", "Identifiant du contrat", { required: true, min_value: 1 })]),
          sub("cancel", "Annule un contrat encore ouvert et récupère l’escrow", [opt(4, "id", "Identifiant du contrat", { required: true, min_value: 1 })]),
        ],
      }),
    ],
  },
  {
    name: "bank",
    description: "Gère ta banque PND",
    usage: "/bank solde | deposit | withdraw",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("solde", "Affiche ton portefeuille et ta banque"),
      sub("deposit", "Dépose des PND en banque", [
        opt(4, "montant", "Montant à déposer", { required: true, min_value: 1, max_value: 1_000_000_000 }),
      ]),
      sub("withdraw", "Retire des PND de la banque", [
        opt(4, "montant", "Montant à retirer", { required: true, min_value: 1, max_value: 1_000_000_000 }),
      ]),
    ],
  },
  {
    name: "history",
    description: "Affiche tes dix derniers mouvements PND",
    usage: "/history",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "rob",
    description: "Tente de voler des PND à un membre (risqué)",
    usage: "/rob membre",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à voler", { required: true })],
  },
  {
    name: "lottery",
    description: "Participe à la loterie PND du serveur",
    usage: "/lottery info | buy | draw",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("info", "Affiche la cagnotte et les tickets"),
      sub("buy", "Achète des tickets (100 PND chacun)", [
        opt(4, "nombre", "Nombre de tickets (1–10)", { required: true, min_value: 1, max_value: 10 }),
      ]),
      sub("draw", "Lance le tirage (administration)", []),
    ],
  },
  {
    name: "pay",
    description: "Transfère des PND à un membre",
    usage: "/pay membre montant",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre qui reçoit les PND", { required: true }),
      opt(4, "montant", "Montant à transférer", { required: true, min_value: 1, max_value: 1_000_000_000 }),
    ],
  },
  {
    name: "leaderboard",
    description: "Affiche le classement des soldes PND du serveur",
    usage: "/leaderboard",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "inventory",
    description: "Affiche les rôles achetés dans la boutique",
    usage: "/inventory",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "shop",
    description: "Affiche ou gère la boutique de rôles PND",
    usage: "/shop voir | ajouter | retirer",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Affiche les rôles en vente"),
      sub("ajouter", "Ajoute un rôle à la boutique (administration)", [
        opt(8, "role", "Rôle à vendre", { required: true }),
        opt(4, "prix", "Prix en PND", { required: true, min_value: 1, max_value: 1_000_000_000 }),
      ]),
      sub("retirer", "Retire un rôle de la boutique (administration)", [
        opt(8, "role", "Rôle à retirer", { required: true }),
      ]),
      opt(2, "market", "Revends des rôles de ta collection sur le marché du serveur", {
        options: [
          sub("list", "Affiche les annonces ouvertes"),
          sub("sell", "Met un rôle de boutique que tu possèdes en vente", [
            opt(8, "role", "Rôle à vendre", { required: true }),
            opt(4, "prix", "Prix en PND", { required: true, min_value: 1, max_value: 1_000_000_000 }),
          ]),
          sub("buy", "Achète et reçois un rôle annoncé", [opt(4, "id", "Identifiant de l’annonce", { required: true, min_value: 1 })]),
          sub("cancel", "Retire ta propre annonce ouverte", [opt(4, "id", "Identifiant de l’annonce", { required: true, min_value: 1 })]),
        ],
      }),
      opt(2, "auction", "Mets aux enchères un rôle acheté ou enchéris sur ce serveur", {
        options: [
          sub("list", "Affiche les enchères ouvertes"),
          sub("create", "Ouvre une enchère de 10 minutes à 7 jours", [
            opt(8, "role", "Rôle de boutique que tu possèdes", { required: true }),
            opt(4, "prix-initial", "Prix minimal en PND", { required: true, min_value: 1, max_value: 1_000_000_000 }),
            opt(4, "duree-minutes", "Durée de l’enchère en minutes", { required: true, min_value: 10, max_value: 10_080 }),
          ]),
          sub("bid", "Place une offre qui sera retenue en escrow", [
            opt(4, "id", "Identifiant de l’enchère", { required: true, min_value: 1 }),
            opt(4, "montant", "Offre PND, supérieure à la meilleure offre", { required: true, min_value: 1, max_value: 1_000_000_000 }),
          ]),
          sub("cancel", "Annule ta propre enchère sans offre", [opt(4, "id", "Identifiant de l’enchère", { required: true, min_value: 1 })]),
        ],
      }),
    ],
  },
  {
    name: "buy",
    description: "Achète un rôle de la boutique PND",
    usage: "/buy role",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(8, "role", "Rôle à acheter", { required: true })],
  },
  {
    name: "pnd",
    description: "Gère le solde PND (identifiant propriétaire configuré)",
    usage: "/pnd ajouter|retirer|definir|historique|audit",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("ajouter", "Ajoute des PND à un membre", [
        opt(6, "membre", "Membre concerné", { required: true }),
        opt(4, "montant", "Montant à ajouter", { required: true, min_value: 1, max_value: 1_000_000_000 }),
      ]),
      sub("retirer", "Retire des PND à un membre", [
        opt(6, "membre", "Membre concerné", { required: true }),
        opt(4, "montant", "Montant à retirer", { required: true, min_value: 1, max_value: 1_000_000_000 }),
      ]),
      sub("definir", "Définit le solde exact d’un membre", [
        opt(6, "membre", "Membre concerné", { required: true }),
        opt(4, "montant", "Nouveau solde", { required: true, min_value: 0, max_value: 1_000_000_000 }),
      ]),
      sub("historique", "Consulte l’historique PND d’un membre", [opt(6, "membre", "Membre (facultatif)")]),
      sub("audit", "Consulte l’audit des opérations PND"),
    ],
  },
  {
    name: "roulette",
    description: "Joue à la roulette PND",
    usage: "/roulette mise choix",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(4, "mise", "Montant misé", { required: true, min_value: 1, max_value: 1_000_000_000 }),
      opt(3, "choix", "Couleur sur laquelle miser", {
        required: true,
        choices: [
          { name: "Rouge", value: "red" },
          { name: "Noir", value: "black" },
          { name: "Vert (0)", value: "green" },
        ],
      }),
    ],
  },
  {
    name: "blackjack",
    description: "Joue au blackjack PND",
    usage: "/blackjack mise",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "mise", "Montant misé", { required: true, min_value: 1, max_value: 1_000_000_000 })],
  },

  // ── Social ─────────────────────────────────────────────────────────────────
  {
    name: "profil",
    description: "Affiche le profil social d’un membre",
    usage: "/profil [membre]",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre dont afficher le profil")],
  },
  {
    name: "bio",
    description: "Définit ta biographie de profil",
    usage: "/bio texte",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "texte", "Biographie (280 caractères maximum)", { required: true, max_length: 280 })],
  },
  {
    name: "rep",
    description: "Réputation : donner un point ou voir l’historique",
    usage: "/rep donner membre [raison] · /rep historique [membre]",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("donner", "Donne un point de réputation à un membre", [
        opt(6, "membre", "Membre à récompenser", { required: true }),
        opt(3, "raison", "Raison (facultative)", { max_length: 200 }),
      ]),
      sub("historique", "Historique des points de réputation", [
        opt(6, "membre", "Membre concerné (toi par défaut)"),
      ]),
    ],
  },
  {
    name: "toprep",
    description: "Affiche le classement de réputation du serveur",
    usage: "/toprep",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "color",
    description: "Change la couleur de ton profil",
    usage: "/color #5865f2",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "couleur", "Couleur hexadécimale (#RRGGBB)", { required: true, min_length: 4, max_length: 7 })],
  },

  {
    name: "cards",
    description: "Affiche une collection de cartes",
    usage: "/cards [membre]",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre dont afficher la collection")],
  },
  {
    name: "card",
    description: "Affiche les détails d’une carte",
    usage: "/card identifiant",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "carte", "Identifiant de la carte (ex. dragon)", { required: true, max_length: 32 })],
  },
  {
    name: "pack",
    description: "Ouvre un pack de trois cartes (250 PND)",
    usage: "/pack",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "trade",
    description: "Propose ou gère un échange de cartes",
    usage: "/trade proposer | accepter | annuler | liste",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("proposer", "Propose un échange à un membre", [
        opt(6, "membre", "Membre à qui proposer", { required: true }),
        opt(3, "offre", "Carte que tu donnes", { required: true, max_length: 32 }),
        opt(3, "demande", "Carte que tu veux recevoir", { required: true, max_length: 32 }),
      ]),
      sub("accepter", "Accepte un échange", [opt(3, "id", "Identifiant de l’échange", { required: true, max_length: 12 })]),
      sub("annuler", "Annule un échange que tu as proposé", [opt(3, "id", "Identifiant de l’échange", { required: true, max_length: 12 })]),
      sub("liste", "Liste tes échanges en attente"),
    ],
  },

  // ── Jeux & événements ──────────────────────────────────────────────────────
  {
    name: "dice",
    description: "Lance un ou plusieurs dés",
    usage: "/dice [faces] [nombre]",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(4, "faces", "Nombre de faces (2–100, défaut 6)", { min_value: 2, max_value: 100 }),
      opt(4, "nombre", "Nombre de dés (1–10, défaut 1)", { min_value: 1, max_value: 10 }),
    ],
  },
  {
    name: "coinflip",
    description: "Parie des PND sur pile ou face",
    usage: "/coinflip mise [face]",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(4, "mise", "Mise en PND (10–10000)", { required: true, min_value: 10, max_value: 10000 }),
      opt(3, "face", "Ton choix", { choices: [
        { name: "Pile", value: "pile" },
        { name: "Face", value: "face" },
      ] }),
    ],
  },
  {
    name: "trivia",
    description: "Lance une question de culture générale récompensée",
    usage: "/trivia",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "giveaway",
    description: "Crée et gère des giveaways",
    usage: "/giveaway start | end | list | reroll | verifier",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("start", "Lance un giveaway", [
        opt(3, "prix", "Récompense du giveaway", { required: true, max_length: 200 }),
        opt(3, "duree", "Durée : 30m, 2h, 1d…", { required: true, max_length: 20 }),
        opt(4, "gagnants", "Nombre de gagnants (1–10)", { min_value: 1, max_value: 10 }),
      ]),
      sub("end", "Termine un giveaway immédiatement", [
        opt(3, "id", "Identifiant du giveaway", { required: true, max_length: 12 }),
      ]),
      sub("list", "Liste les giveaways du serveur"),
      sub("reroll", "Nouveau tirage vérifiable (anciens gagnants exclus)", [
        opt(3, "id", "Identifiant du giveaway", { required: true, max_length: 12 }),
        opt(4, "gagnants", "Nombre de gagnants (1–10)", { min_value: 1, max_value: 10 }),
      ]),
      sub("verifier", "Rejoue et vérifie les tirages d'un giveaway", [
        opt(3, "id", "Identifiant du giveaway", { required: true, max_length: 12 }),
      ]),
    ],
  },
  {
    name: "event",
    description: "Crée et consulte les événements du serveur",
    usage: "/event creer | liste | supprimer",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("creer", "Crée un événement", [
        opt(3, "titre", "Titre de l’événement", { required: true, max_length: 100 }),
        opt(3, "date", "Date : JJ/MM/AAAA HH:mm ou ISO", { required: true, max_length: 40 }),
        opt(3, "description", "Description (facultative)", { max_length: 1000 }),
      ]),
      sub("liste", "Liste les prochains événements"),
      sub("supprimer", "Supprime un événement", [
        opt(4, "id", "Identifiant de l’événement", { required: true, min_value: 1 }),
      ]),
    ],
  },

  // ── Extensions PND V5 ──────────────────────────────────────────────────────
  {
    name: "business",
    description: "Gère les entreprises et leur trésorerie PND",
    usage: "/business list | create | info | hire | salary | fire | deposit | withdraw | payroll",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("list", "Liste les entreprises du serveur"),
      sub("create", "Crée une entreprise", [opt(3, "nom", "Nom de l’entreprise", { required: true, max_length: 40 })]),
      sub("info", "Affiche une entreprise", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 })]),
      sub("hire", "Recrute un membre", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 }), opt(6, "membre", "Membre à recruter", { required: true })]),
      sub("salary", "Définit le salaire d’un employé", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 }), opt(6, "membre", "Employé", { required: true }), opt(4, "montant", "Salaire en PND", { required: true, min_value: 0, max_value: 1000000000 })]),
      sub("fire", "Retire un membre de l’entreprise", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 }), opt(6, "membre", "Membre à retirer", { required: true })]),
      sub("deposit", "Verse des PND à la trésorerie", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 }), opt(4, "montant", "Montant en PND", { required: true, min_value: 1, max_value: 1000000000 })]),
      sub("withdraw", "Retire des PND de la trésorerie", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 }), opt(4, "montant", "Montant en PND", { required: true, min_value: 1, max_value: 1000000000 })]),
      sub("payroll", "Verse la paie de la période", [opt(3, "id", "Identifiant de l’entreprise", { required: true, max_length: 36 })]),
    ],
  },
  {
    name: "invest",
    description: "Gère tes placements virtuels PND",
    usage: "/invest list | create | close | policy | status",
    category: "Économie PND",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("list", "Liste tes placements"),
      sub("create", "Ouvre un placement", [opt(4, "montant", "Capital investi en PND", { required: true, min_value: 1, max_value: 1000000000 }), opt(4, "risque", "Risque en points de base (facultatif)", { min_value: 1, max_value: 1000 })]),
      sub("close", "Clôture un placement", [opt(3, "id", "Identifiant du placement", { required: true, max_length: 36 })]),
      sub("policy", "Configure le risque maximal du serveur", [opt(4, "defaut", "Risque par défaut en points de base", { required: true, min_value: 1, max_value: 1000 }), opt(4, "maximum", "Risque maximal en points de base", { required: true, min_value: 1, max_value: 1000 })]),
      sub("status", "Affiche la politique de risque du serveur"),
    ],
  },
  {
    name: "casino",
    description: "Joue au Casino PND avec de la monnaie virtuelle",
    usage: "/casino roulette | slots | coinflip | dice | historique | stats",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("roulette", "Mise sur une couleur ou un numéro", [opt(4, "mise", "Mise en PND", { required: true, min_value: 1, max_value: 1000000000 }), opt(3, "choix", "rouge, noir, vert ou numéro 0–36", { required: true, max_length: 5 })]),
      sub("slots", "Lance la machine à sous", [opt(4, "mise", "Mise en PND", { required: true, min_value: 1, max_value: 1000000000 })]),
      sub("coinflip", "Joue à pile ou face", [opt(4, "mise", "Mise en PND", { required: true, min_value: 1, max_value: 1000000000 }), opt(3, "choix", "pile ou face", { required: true, choices: [{ name: "Pile", value: "pile" }, { name: "Face", value: "face" }] })]),
      sub("dice", "Parie sur une face du dé", [opt(4, "mise", "Mise en PND", { required: true, min_value: 1, max_value: 1000000000 }), opt(3, "choix", "Face attendue (1 à 6)", { required: true, choices: [1,2,3,4,5,6].map((n) => ({ name: String(n), value: String(n) })) })]),
      sub("historique", "Consulte tes dernières parties"),
      sub("stats", "Consulte tes statistiques Casino"),
      sub("limites", "Consulte tes protections de jeu"),
      sub("limite", "Fixe ta limite quotidienne de mises", [opt(4, "montant", "Maximum quotidien en PND", { required: true, min_value: 1, max_value: 1000000000 })]),
      sub("limite-off", "Désactive ta limite quotidienne de mises"),
      sub("pause", "Active une auto-exclusion personnelle", [opt(3, "duree", "Durée de l'auto-exclusion", { required: true, choices: [{ name: "24 heures", value: "24h" }, { name: "7 jours", value: "7j" }, { name: "30 jours", value: "30j" }, { name: "Permanente", value: "permanent" }] })]),
    ],
  },
  {
    name: "pndevent",
    description: "Gère les événements de la communauté PND",
    usage: "/pndevent liste | creer | join | leave | cancel",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Liste les prochains événements"),
      sub("creer", "Crée un événement", [opt(3, "date", "Date ISO avec fuseau, ex. 2026-12-01T20:00:00+01:00", { required: true, max_length: 40 }), opt(3, "titre", "Titre", { required: true, max_length: 100 }), opt(3, "description", "Description", { max_length: 1000 })]),
      sub("join", "Inscris-toi à un événement", [opt(4, "id", "Numéro de l’événement", { required: true, min_value: 1 })]),
      sub("leave", "Désinscris-toi d’un événement", [opt(4, "id", "Numéro de l’événement", { required: true, min_value: 1 })]),
      sub("cancel", "Annule un événement (organisateur ou staff)", [opt(4, "id", "Numéro de l’événement", { required: true, min_value: 1 })]),
    ],
  },
  {
    name: "academy",
    description: "Accède aux parcours PND Academy",
    usage: "/academy liste | creer | show | complete",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Liste les parcours de formation"),
      sub("creer", "Crée un parcours (staff)", [opt(3, "titre", "Titre du parcours", { required: true, max_length: 80 }), opt(3, "etapes", "Étapes séparées par ; au format Titre:Description", { required: true, max_length: 1500 })]),
      sub("show", "Affiche un parcours ou le détail d’une étape", [opt(3, "id", "Identifiant du parcours", { required: true, max_length: 36 }), opt(4, "etape", "Numéro d’étape (facultatif)", { min_value: 1, max_value: 20 })]),
      sub("complete", "Valide une étape", [opt(3, "id", "Identifiant du parcours", { required: true, max_length: 36 }), opt(4, "etape", "Numéro de l’étape", { required: true, min_value: 1, max_value: 20 }), opt(3, "reponses", "Réponses numériques séparées par des virgules (1-based)", { max_length: 100 })]),
      sub("progress", "Consulte ta progression", [opt(3, "id", "Identifiant du parcours", { required: true, max_length: 36 })]),
      sub("quiz", "Ajoute une question à une étape (staff)", [opt(3, "id", "Identifiant du parcours", { required: true, max_length: 36 }), opt(4, "etape", "Numéro de l’étape", { required: true, min_value: 1, max_value: 20 }), opt(3, "configuration", "Question | choix 1 | choix 2 | bonne réponse (1-based)", { required: true, max_length: 900 })]),
    ],
  },
  {
    name: "award",
    description: "Organise les votes et récompenses communautaires",
    usage: "/award liste | creer | vote | close",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Liste les campagnes ouvertes"),
      sub("creer", "Crée une campagne (staff)", [opt(3, "fin", "Date ISO avec fuseau", { required: true, max_length: 40 }), opt(3, "titre", "Titre", { required: true, max_length: 100 }), opt(3, "choix", "Options séparées par |", { required: true, max_length: 500 })]),
      sub("vote", "Vote pour une option", [opt(3, "id", "Identifiant de campagne", { required: true, max_length: 36 }), opt(4, "option", "Numéro de l’option", { required: true, min_value: 1, max_value: 10 })]),
      sub("close", "Clôture une campagne (staff)", [opt(3, "id", "Identifiant de campagne", { required: true, max_length: 36 })]),
    ],
  },
  {
    name: "story",
    description: "Propose et publie des stories communautaires",
    usage: "/story liste | creer | approve | publish",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Liste les stories publiées"),
      sub("creer", "Propose une story", [opt(3, "titre", "Titre", { required: true, max_length: 100 }), opt(3, "texte", "Texte", { required: true, max_length: 1500 })]),
      sub("approve", "Valide une story (staff)", [opt(3, "id", "Identifiant de story", { required: true, max_length: 36 })]),
      sub("publish", "Publie une story validée (staff)", [opt(3, "id", "Identifiant de story", { required: true, max_length: 36 })]),
    ],
  },
  {
    name: "radar",
    description: "Consulte les statistiques PND agrégées (staff)",
    usage: "/radar [du] [au]",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "du", "Date de début AAAA-MM-JJ", { max_length: 10 }), opt(3, "au", "Date de fin AAAA-MM-JJ", { max_length: 10 })],
  },
  {
    name: "wrapped",
    description: "Affiche ton bilan PND des 30 derniers jours",
    usage: "/wrapped",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "candidature",
    description: "Dépose et gère les candidatures PND",
    usage: "/candidature deposer|liste|questions|voir|review|assign|entretien|entretiens|evaluation|annuler-entretien",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("deposer", "Dépose une candidature pour rejoindre l’équipe PND", [opt(3, "reponses", "Réponses séparées par |, sans données sensibles", { required: true, max_length: 1000 })]),
      sub("liste", "Liste les candidatures en attente"),
      sub("questions", "Configure les questions du formulaire de candidature", [opt(3, "configuration", "Questions séparées par | (1 à 10)", { required: true, max_length: 2000 })]),
      sub("voir", "Affiche un dossier", [opt(3, "id", "Identifiant de candidature", { required: true, max_length: 36 })]),
      sub("review", "Prend une décision sur un dossier", [opt(3, "id", "Identifiant de candidature", { required: true, max_length: 36 }), opt(3, "decision", "Décision", { required: true, choices: [{ name: "Accepter", value: "accepted" }, { name: "Refuser", value: "rejected" }, { name: "À revoir", value: "review" }] }), opt(3, "note", "Note interne", { max_length: 300 })]),
      sub("assign", "Affecte un responsable à une candidature", [opt(3, "id", "Identifiant de candidature", { required: true, max_length: 36 }), opt(6, "responsable", "Membre responsable", { required: true })]),
      sub("entretien", "Planifie un entretien", [opt(3, "id", "Identifiant de candidature", { required: true, max_length: 36 }), opt(3, "date", "Date ISO avec fuseau horaire", { required: true, max_length: 40 }), opt(6, "evaluateur", "Membre évaluateur", { required: true }), opt(7, "salon", "Salon textuel facultatif")]),
      sub("entretiens", "Liste les entretiens à venir"),
      sub("evaluation", "Évalue un entretien terminé", [opt(3, "id", "Identifiant de l'entretien", { required: true, max_length: 36 }), opt(4, "note", "Note de 1 à 5", { required: true, min_value: 1, max_value: 5 }), opt(3, "commentaire", "Évaluation interne", { max_length: 1000 })]),
      sub("annuler-entretien", "Annule un entretien planifié", [opt(3, "id", "Identifiant de l'entretien", { required: true, max_length: 36 })]),
    ],
  },

  {
    name: "anti-moove",
    description: "Protège individuellement les membres contre les déplacements vocaux forcés",
    usage: "/anti-moove config|proteger|retirer|liste|exception-ajouter|exception-retirer|exceptions",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("config", "Active, désactive ou affiche l’état global", [
        opt(3, "etat", "Nouvel état global (facultatif)", { choices: [
          { name: "Activer", value: "on" },
          { name: "Désactiver", value: "off" },
        ] }),
      ]),
      sub("proteger", "Protège un membre contre les déplacements forcés", [opt(6, "membre", "Membre à protéger", { required: true })]),
      sub("retirer", "Retire la protection individuelle", [opt(6, "membre", "Membre à déprotéger", { required: true })]),
      sub("liste", "Liste les membres protégés et les exceptions"),
      sub("exception-ajouter", "Autorise un membre à déplacer les membres protégés", [opt(6, "membre", "Membre autorisé", { required: true })]),
      sub("exception-retirer", "Retire une exception individuelle", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("exceptions", "Liste les membres autorisés à déplacer les membres protégés"),
    ],
  },

  {
    name: "wakeup",
    description: "Réveille un membre en le faisant passer par chaque salon vocal public",
    usage: "/wakeup membre [message]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à réveiller (connecté en vocal)", { required: true }),
      opt(3, "message", "Message d'accompagnement (facultatif)", { max_length: 300 }),
    ],
  },
  {
    name: "vocalpresence",
    description: "Consulte les présences vocales historiques observées",
    usage: "/vocalpresence date",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "date", "Date ISO ou timestamp Unix", { required: true, max_length: 40 })],
  },

  {
    name: "staffhistory",
    description: "Consulte l'historique de modération et de présence d'un membre",
    usage: "/staffhistory membre",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre concerné", { required: true })],
  },

  // ── DOG ────────────────────────────────────────────────────────────────────
  {
    name: "dog",
    description: "Met un membre en laisse ou liste les laisses actives",
    usage: "/dog [membre]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à mettre en laisse (vide pour afficher la liste)")],
  },
  {
    name: "undog",
    description: "Retire la laisse d’un membre",
    usage: "/undog membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à libérer", { required: true })],
  },
  {
    name: "lockname",
    description: "Protège les pseudonymes contre les modifications ultérieures",
    usage: "/lockname proteger|retirer|liste",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("proteger", "Mémorise le pseudonyme actuel d’un membre", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("retirer", "Désactive la protection d’un membre", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("liste", "Affiche les pseudonymes protégés de ce serveur"),
    ],
  },
  {
    name: "wouaf",
    description: "Configure et active le remplacement temporaire des messages par WOUAF",
    usage: "/wouaf canal-ajouter|activer|stop|statut",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("canal-ajouter", "Autorise un salon textuel", [opt(7, "salon", "Salon où WAOUF peut agir", { required: true, channel_types: [0] })]),
      sub("canal-retirer", "Retire un salon autorisé", [opt(7, "salon", "Salon à retirer", { required: true, channel_types: [0] })]),
      sub("phrase-ajouter", "Ajoute une phrase humoristique", [opt(3, "phrase", "Utilise {membre} pour mentionner la cible", { required: true, max_length: 180 })]),
      sub("phrase-retirer", "Retire une phrase par son numéro", [opt(4, "numero", "Numéro affiché par /wouaf statut", { required: true, min_value: 1, max_value: 20 })]),
      sub("duree", "Règle la durée par défaut", [opt(4, "minutes", "Durée entre 1 et 1 440 minutes", { required: true, min_value: 1, max_value: 1440 })]),
      sub("repetitions", "Règle après combien de messages utiliser les phrases", [opt(4, "nombre", "Nombre entre 2 et 20", { required: true, min_value: 2, max_value: 20 })]),
      sub("cooldown", "Règle l’intervalle minimum des réponses", [opt(4, "secondes", "Durée entre 5 et 300 secondes", { required: true, min_value: 5, max_value: 300 })]),
      sub("activer", "Active WAOUF temporairement pour un membre", [
        opt(6, "membre", "Membre cible", { required: true }),
        opt(4, "duree_minutes", "Durée facultative (1 à 1 440 minutes)", { min_value: 1, max_value: 1440 }),
      ]),
      sub("stop", "Arrête immédiatement WAOUF pour un membre", [opt(6, "membre", "Membre cible", { required: true })]),
      sub("stop-tout", "Arrête immédiatement toutes les activations"),
      sub("statut", "Affiche la configuration et les activations en cours"),
    ],
  },
  {
    name: "doginfo",
    description: "Affiche la laisse DOG d’un membre",
    usage: "/doginfo membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à consulter", { required: true })],
  },
  {
    name: "menotte",
    description: "Immobilise un membre dans ton salon vocal avec durée facultative",
    usage: "/menotte membre [duree_minutes]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à menotter", { required: true }),
      opt(4, "duree_minutes", "Durée en minutes (1 à 30 jours)", { min_value: 1, max_value: 43_200 }),
    ],
  },
  {
    name: "unmenotte",
    description: "Libère un membre du système MENOTTE",
    usage: "/unmenotte membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à libérer", { required: true })],
  },
  {
    name: "menotteinfo",
    description: "Consulte l’état et l’échéance d’une MENOTTE",
    usage: "/menotteinfo membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à consulter", { required: true })],
  },

  // ── Vocal ──────────────────────────────────────────────────────────────────
  {
    name: "access",
    description: "Autorise un membre à rejoindre ton salon vocal",
    usage: "/access membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à autoriser", { required: true })],
  },
  {
    name: "unaccess",
    description: "Retire l’accès d’un membre à ton salon vocal",
    usage: "/unaccess membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à retirer de la liste d’accès", { required: true })],
  },
  {
    name: "pv",
    description: "Salon vocal privé : activer, lister ou rétablir",
    usage: "/pv activer | liste | retirer",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("activer", "Rend ton salon vocal actuel privé"),
      sub("liste", "Liste les salons privatisés du serveur"),
      sub("retirer", "Rétablit les permissions d’origine de ton salon vocal"),
    ],
  },
  {
    name: "panel",
    description: "Ouvre le centre de contrôle FWU",
    usage: "/panel",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "setup",
    description: "Configure les modules du serveur avec aperçu avant application",
    usage: "/setup",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "knowledge",
    description: "Consulte et modifie les rubriques d'information du serveur",
    usage: "/knowledge panel | show | edit",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Publie le panneau interactif PND Knowledge"),
      sub("show", "Affiche une rubrique", [
        opt(3, "rubrique", "Rubrique à consulter", { required: true, choices: [
          { name: "Permissions & hiérarchie", value: "permissions" },
          { name: "Recrutement", value: "recruitment" },
          { name: "Tickets & assistance", value: "tickets" },
          { name: "Règlement", value: "rules" },
          { name: "Guide du serveur", value: "guide" },
          { name: "Guide SYS+", value: "sysplus" },
        ] }),
      ]),
      sub("edit", "Modifie une rubrique (Gérer le serveur)", [
        opt(3, "rubrique", "Rubrique à modifier", { required: true, choices: [
          { name: "Permissions & hiérarchie", value: "permissions" },
          { name: "Recrutement", value: "recruitment" },
          { name: "Tickets & assistance", value: "tickets" },
          { name: "Règlement", value: "rules" },
          { name: "Guide du serveur", value: "guide" },
          { name: "Guide SYS+", value: "sysplus" },
        ] }),
        opt(3, "titre", "Titre affiché", { required: true, min_length: 2, max_length: 100 }),
        opt(3, "contenu", "Texte de la rubrique", { required: true, min_length: 5, max_length: 4000 }),
      ]),
    ],
  },
  {
    name: "voc",
    description: "Gère ton salon vocal temporaire",
    usage: "/voc panel | vocal-panel | demander | demander-id | limit | name | claim | expulser | inviter | transferer | lock | unlock | delete",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Affiche les informations du salon temporaire"),
      sub("vocal-panel", "Ouvre le panneau de contrôle d’accès vocal classique"),
      sub("demander", "Demande l’accès à une vocale privée", [opt(7, "salon", "Vocale privée à rejoindre", { required: true, channel_types: [2] })]),
      sub("demander-id", "Demande l’accès à une vocale cachée via son ID", [opt(3, "id", "ID de la vocale privée", { required: true, min_length: 5, max_length: 25 })]),
      sub("debloquer", "Autorise un membre à refaire une demande vocale", [opt(7, "salon", "Vocale privée", { required: true, channel_types: [2] }), opt(6, "membre", "Membre à débloquer", { required: true })]),
      sub("limit", "Règle la limite de membres", [
        opt(4, "nombre", "0 = illimité, 1–99", { required: true, min_value: 0, max_value: 99 }),
      ]),
      sub("name", "Renomme le salon temporaire", [
        opt(3, "nom", "Nouveau nom", { required: true, max_length: 100 }),
      ]),
      sub("claim", "Deviens propriétaire si l’ancien a quitté"),
      sub("expulser", "Sort un membre de ton salon et l’empêche de revenir", [opt(6, "membre", "Membre", { required: true })]),
      sub("inviter", "Autorise un membre à rejoindre ton salon", [opt(6, "membre", "Membre", { required: true })]),
      sub("transferer", "Donne la propriété du salon à un membre présent", [opt(6, "membre", "Membre", { required: true })]),
      sub("lock", "Empêche les autres membres de rejoindre"),
      sub("unlock", "Autorise à nouveau les membres à rejoindre"),
      sub("delete", "Supprime ton salon temporaire"),
    ],
  },

  // ── Musique ────────────────────────────────────────────────────────────────
  {
    name: "play",
    description: "Joue un lien YouTube/SoundCloud ou recherche un titre",
    usage: "/play lien YouTube ou titre",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "recherche", "Lien YouTube/SoundCloud ou titre à rechercher", { required: true, max_length: 500 })],
  },
  { name: "pause", description: "Met la musique en pause", usage: "/pause", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "resume", description: "Reprend la lecture de la musique", usage: "/resume", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "skip", description: "Passe au titre suivant", usage: "/skip", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "stop", description: "Arrête la musique et vide la file", usage: "/stop", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "queue", description: "Affiche la file d’attente musicale", usage: "/queue", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "nowplaying", description: "Affiche le titre en cours de lecture", usage: "/nowplaying", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  {
    name: "volume",
    description: "Règle le volume de la musique",
    usage: "/volume niveau",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "niveau", "Volume entre 0 et 100", { required: true, min_value: 0, max_value: 100 })],
  },
  {
    name: "loop",
    description: "Change le mode de répétition",
    usage: "/loop mode",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(3, "mode", "Mode de répétition (sans option : passe au suivant)", {
        choices: [
          { name: "Désactivée", value: "off" },
          { name: "Titre", value: "track" },
          { name: "File", value: "queue" },
          { name: "Auto (titres proches à la fin de la file)", value: "auto" },
        ],
      }),
    ],
  },
  { name: "shuffle", description: "Mélange la file d’attente musicale", usage: "/shuffle", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "clearqueue", description: "Vide la file d’attente musicale", usage: "/clearqueue", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  {
    name: "remove",
    description: "Retire un titre de la file d’attente",
    usage: "/remove position",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "position", "Position du titre dans /queue", { required: true, min_value: 1, max_value: 100 })],
  },
  { name: "join", description: "Connecte le bot à ton salon vocal", usage: "/join", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "leave", description: "Déconnecte le bot du salon vocal", usage: "/leave", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },
  { name: "musicpanel", description: "Affiche le panneau de contrôle musical", usage: "/musicpanel", category: "Musique & radio", dmPermission: false, requiresBotProcess: true },

  // ── Radio PND ──────────────────────────────────────────────────────────────
  {
    name: "radio",
    description: "Gère la radio PND 24/7 et ses hôtes autorisés",
    usage: "/radio status | host-add | host-remove | host-list | set | start | stop | clear",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("status", "Affiche l’état de la radio"),
      sub("set", "Configure et lance la radio (administration)", [
        opt(7, "salon", "Salon vocal de diffusion", { required: true, channel_types: [2] }),
        opt(3, "source", "URL de flux audio HTTPS direct", { required: true, max_length: 2000 }),
      ]),
      sub("host-add", "Autorise un hôte audio HTTPS pour ce serveur", [
        opt(3, "hote", "Nom DNS exact, par exemple audio.example.org", { required: true, max_length: 253 }),
      ]),
      sub("host-remove", "Retire un hôte audio autorisé", [
        opt(3, "hote", "Nom DNS exact", { required: true, max_length: 253 }),
      ]),
      sub("host-list", "Liste les hôtes audio autorisés"),
      sub("start", "Démarre la radio configurée (administration)"),
      sub("stop", "Arrête la radio sans effacer sa configuration (administration)"),
      sub("clear", "Supprime la configuration radio (administration)"),
    ],
  },
];

/**
 * Commands that live only on a dedicated FWU application. They are kept out of
 * SLASH_COMMANDS so the historical single application (already 100/100) and the
 * dashboard's "register all" button stay within Discord's limit. Each bot
 * registers them when its own application has room (see bot-profiles.ts).
 */
export const EXTRA_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: "afk",
    description: "RESUME : signale ton absence et retrouve ce qui s’est passé pendant ce temps",
    usage: "/afk on [raison] · /afk off · /afk resume [heures]",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("on", "Démarre ton absence : les événements importants sont gardés pour toi", [
        opt(3, "raison", "Raison visible par le staff (facultatif)", { max_length: 200 }),
      ]),
      sub("off", "Termine ton absence et affiche le résumé de ce que tu as manqué"),
      sub("resume", "Affiche le résumé sans terminer ton absence", [
        opt(4, "heures", "Période à résumer si tu n’es pas absent (1 à 168 h)", { min_value: 1, max_value: 168 }),
      ]),
    ],
  },  {
    name: "live",
    description: "OWNER et SYS+ : règle les alertes LIVE (créateurs, salon, rôle mentionné)",
    usage: "/live etat|activer|desactiver|salon|role|ajouter|retirer",
    category: "Automatisation",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Affiche le réglage des alertes LIVE"),
      sub("activer", "Active les alertes LIVE"),
      sub("desactiver", "Désactive les alertes LIVE"),
      sub("salon", "Choisit le salon des annonces", [opt(7, "salon", "Salon textuel", { required: true, channel_types: [0, 5] })]),
      sub("role", "Rôle mentionné à chaque LIVE (vide = aucun)", [opt(8, "role", "Rôle à mentionner")]),
      sub("ajouter", "Suit un nouveau créateur", [
        opt(3, "plateforme", "Plateforme", { required: true, choices: [{ name: "YouTube", value: "youtube" }, { name: "TikTok", value: "tiktok" }, { name: "Twitch", value: "twitch" }, { name: "Autre", value: "other" }] }),
        opt(3, "nom", "Nom affiché du créateur", { required: true, max_length: 80 }),
        opt(3, "flux", "Adresse HTTPS du flux RSS/Atom", { required: true, max_length: 1000 }),
      ]),
      sub("retirer", "Arrête de suivre un créateur", [opt(3, "nom", "Nom du créateur", { required: true, max_length: 80 })]),
    ],
  },
  {
    name: "blacklist",
    description: "OWNER et SYS+ : bannit un compte et le rebannit automatiquement s’il revient",
    usage: "/blacklist add membre|id [raison] · remove · list · check",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("add", "Blackliste et bannit un compte (même absent du serveur)", [
        opt(6, "membre", "Membre à blacklister"),
        opt(3, "id", "Ou identifiant Discord du compte", { max_length: 25 }),
        opt(3, "raison", "Raison (facultatif)", { max_length: 300 }),
      ]),
      sub("remove", "Retire un compte de la blacklist et le débannit", [
        opt(6, "membre", "Membre concerné"),
        opt(3, "id", "Ou identifiant Discord du compte", { max_length: 25 }),
      ]),
      sub("list", "Affiche la blacklist du serveur"),
      sub("check", "Vérifie si un compte est blacklisté", [
        opt(6, "membre", "Membre concerné"),
        opt(3, "id", "Ou identifiant Discord du compte", { max_length: 25 }),
      ]),
    ],
  },
  {
    name: "dmall",
    description: "Propriétaire : envoie un message privé à tous les membres (aperçu et confirmation)",
    usage: "/dmall message:<texte> [role:@rôle]",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(3, "message", "Message à envoyer (1 800 caractères maximum)", { required: true, max_length: 1800 }),
      opt(8, "role", "Limiter aux membres de ce rôle (facultatif)"),
    ],
  },
  {
    name: "antinuke",
    description: "GUARD : protection contre les destructions en masse (salons, rôles, bans, webhooks)",
    usage: "/antinuke etat | activer | desactiver | seuil | confiance-ajouter | confiance-retirer",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Affiche la protection anti-nuke"),
      sub("activer", "Active l'anti-nuke"),
      sub("desactiver", "Désactive l'anti-nuke"),
      sub("seuil", "Nombre d'actions destructrices tolérées dans la fenêtre", [
        opt(4, "actions", "Actions avant réaction (2 à 20)", { required: true, min_value: 2, max_value: 20 }),
        opt(4, "secondes", "Fenêtre en secondes (10 à 600)", { min_value: 10, max_value: 600 }),
      ]),
      sub("confiance-ajouter", "Exempte une personne de confiance", [opt(6, "membre", "Membre de confiance", { required: true })]),
      sub("confiance-retirer", "Retire une personne de confiance", [opt(6, "membre", "Membre", { required: true })]),
    ],
  },
  {
    name: "automod",
    description: "GUARD : modération automatique (liens, invitations, mots, majuscules, flood)",
    usage: "/automod etat | regle | mot-ajouter | mot-retirer | exempter | retirer-exemption",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Affiche les règles de l'automod"),
      sub("regle", "Active, désactive ou règle une règle", [
        opt(3, "regle", "Règle", { required: true, choices: [
          { name: "Liens", value: "liens" }, { name: "Invitations Discord", value: "invitations" }, { name: "Mots interdits", value: "mots" },
          { name: "Majuscules excessives", value: "majuscules" }, { name: "Flood", value: "flood" },
        ] }),
        opt(3, "etat", "Activer ou désactiver", { required: true, choices: [{ name: "Activer", value: "on" }, { name: "Désactiver", value: "off" }] }),
        opt(3, "action", "Sanction", { choices: [{ name: "Supprimer", value: "supprimer" }, { name: "Supprimer + avertir", value: "avertir" }, { name: "Supprimer + exclure", value: "exclure" }] }),
        opt(4, "minutes", "Durée d'exclusion (1 à 10080)", { min_value: 1, max_value: 10080 }),
      ]),
      sub("mot-ajouter", "Ajoute un mot interdit", [opt(3, "mot", "Mot ou expression", { required: true, max_length: 60 })]),
      sub("mot-retirer", "Retire un mot interdit", [opt(3, "mot", "Mot ou expression", { required: true, max_length: 60 })]),
      sub("exempter", "Exempte un salon ou un rôle", [opt(7, "salon", "Salon"), opt(8, "role", "Rôle")]),
      sub("retirer-exemption", "Retire l'exemption d'un salon ou d'un rôle", [opt(7, "salon", "Salon"), opt(8, "role", "Rôle")]),
    ],
  },
  {
    name: "casier",
    description: "GUARD : historique des sanctions d'un membre",
    usage: "/casier voir membre · /casier supprimer affaire",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Affiche le casier d'un membre", [opt(6, "membre", "Membre", { required: true })]),
      sub("supprimer", "Supprime une affaire du casier", [opt(4, "affaire", "Numéro de l'affaire", { required: true, min_value: 1 })]),
    ],
  },
  {
    name: "quarantaine",
    description: "GUARD : isole un membre (rôles mis de côté) ou lève l'isolement",
    usage: "/quarantaine ajouter membre [raison] · /quarantaine retirer membre",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("ajouter", "Met un membre en quarantaine", [opt(6, "membre", "Membre", { required: true }), opt(3, "raison", "Raison", { max_length: 300 })]),
      sub("retirer", "Lève la quarantaine et rend les rôles", [opt(6, "membre", "Membre", { required: true })]),
    ],
  },
  {
    name: "niveau",
    description: "Niveaux et XP : ton niveau, le classement, les récompenses",
    usage: "/niveau voir [membre] | succes [membre] | classement | recompenses | salon | recompense-ajouter | recompense-retirer | activer | desactiver",
    category: "Social",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Affiche un niveau", [opt(6, "membre", "Membre (toi par défaut)")]),
      sub("classement", "Top 10 des niveaux du serveur"),
      sub("succes", "Succès débloqués et à débloquer", [opt(6, "membre", "Membre (toi par défaut)")]),
      sub("recompenses", "Liste les rôles débloqués par niveau"),
      sub("salon", "Staff : salon d'annonce des passages de niveau (vide = salon du message)", [opt(7, "salon", "Salon", { channel_types: [0] })]),
      sub("recompense-ajouter", "Staff : donne un rôle à un niveau", [opt(4, "niveau", "Niveau", { required: true, min_value: 1, max_value: 500 }), opt(8, "role", "Rôle", { required: true })]),
      sub("recompense-retirer", "Staff : retire la récompense d'un niveau", [opt(4, "niveau", "Niveau", { required: true, min_value: 1, max_value: 500 })]),
      sub("activer", "Staff : active les niveaux"),
      sub("desactiver", "Staff : désactive les niveaux (l'XP est gardée)"),
    ],
  },
  {
    name: "suggestion",
    description: "Propose une idée au serveur, votée par les membres",
    usage: "/suggestion proposer texte · /suggestion salon · /suggestion repondre",
    category: "Social",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("proposer", "Propose une suggestion", [opt(3, "texte", "Ton idée", { required: true, max_length: 1500 })]),
      sub("salon", "Staff : salon des suggestions", [opt(7, "salon", "Salon", { required: true, channel_types: [0] })]),
      sub("repondre", "Staff : accepte ou refuse une suggestion", [
        opt(4, "id", "Numéro de la suggestion", { required: true, min_value: 1 }),
        opt(3, "decision", "Décision", { required: true, choices: [{ name: "Accepter", value: "accepted" }, { name: "Refuser", value: "refused" }] }),
        opt(3, "raison", "Réponse (facultatif)", { max_length: 500 }),
      ]),
    ],
  },
  {
    name: "anniversaire",
    description: "Anniversaires du serveur, souhaités automatiquement",
    usage: "/anniversaire definir jour mois · retirer · liste · config",
    category: "Social",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("definir", "Enregistre ton anniversaire", [opt(4, "jour", "Jour", { required: true, min_value: 1, max_value: 31 }), opt(4, "mois", "Mois", { required: true, min_value: 1, max_value: 12 })]),
      sub("retirer", "Retire ton anniversaire"),
      sub("liste", "Prochains anniversaires"),
      sub("config", "Staff : salon d'annonce et rôle du jour", [opt(7, "salon", "Salon", { channel_types: [0] }), opt(8, "role", "Rôle donné le jour J")]),
    ],
  },
  {
    name: "rappel",
    description: "Programme un rappel",
    usage: "/rappel creer dans message · liste · supprimer",
    category: "Utilitaires",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("creer", "Crée un rappel", [opt(3, "dans", "Délai : 10m, 2h, 1j12h…", { required: true, max_length: 20 }), opt(3, "message", "Texte du rappel", { required: true, max_length: 500 })]),
      sub("liste", "Tes rappels en cours"),
      sub("supprimer", "Supprime un rappel", [opt(4, "id", "Numéro du rappel", { required: true, min_value: 1 })]),
    ],
  },
  {
    name: "stats",
    description: "Statistiques du serveur",
    usage: "/stats serveur",
    category: "Utilitaires",
    dmPermission: false,
    requiresBotProcess: true,
    options: [sub("serveur", "Membres, salons, vocal, top niveaux")],
  },
  {
    name: "impots",
    description: "LE FISC : impôts sur les transferts et la fortune, caisse du serveur",
    usage: "/impots etat · config · verser",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Taux d'imposition et caisse du serveur"),
      sub("config", "Admin : règle les impôts", [
        opt(4, "transferts", "Impôt sur les transferts en % (0 à 20)", { min_value: 0, max_value: 20 }),
        opt(4, "fortune", "Impôt hebdo sur la fortune en % (0 à 10)", { min_value: 0, max_value: 10 }),
        opt(4, "seuil", "Fortune exonérée (PND)", { min_value: 1000, max_value: 1000000000 }),
      ]),
      sub("verser", "Admin : verse de l'argent de la caisse à un membre", [opt(6, "membre", "Membre", { required: true }), opt(4, "montant", "Montant", { required: true, min_value: 1 })]),
    ],
  },
  {
    name: "pret",
    description: "LE FISC : emprunte des PND avec intérêts",
    usage: "/pret demander montant [jours] · rembourser [montant] · etat",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("demander", "Demande un prêt (10 % d'intérêts)", [opt(4, "montant", "Montant", { required: true, min_value: 100, max_value: 50000 }), opt(4, "jours", "Durée (1 à 14 jours, 7 par défaut)", { min_value: 1, max_value: 14 })]),
      sub("rembourser", "Rembourse ton prêt", [opt(4, "montant", "Montant (tout par défaut)", { min_value: 1 })]),
      sub("etat", "Ton prêt en cours"),
    ],
  },
  {
    name: "duel",
    description: "LE FISC : défie un membre, le gagnant rafle la mise",
    usage: "/duel membre mise [jeu]",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Adversaire", { required: true }),
      opt(4, "mise", "Mise de chaque joueur", { required: true, min_value: 10, max_value: 1000000 }),
      opt(3, "jeu", "Jeu", { choices: [{ name: "Pile ou face", value: "pile" }, { name: "Dés", value: "des" }] }),
    ],
  },
  {
    name: "pari",
    description: "LE FISC : ticket à gratter ou course de chevaux",
    usage: "/pari grattage mise · /pari course mise cheval",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("grattage", "Ticket à gratter (jusqu'à x20)", [opt(4, "mise", "Mise", { required: true, min_value: 10, max_value: 100000 })]),
      sub("course", "Parie sur un cheval (x4)", [opt(4, "mise", "Mise", { required: true, min_value: 10, max_value: 100000 }), opt(4, "cheval", "Cheval 1 à 5", { required: true, min_value: 1, max_value: 5 })]),
    ],
  },
  {
    name: "roletemp",
    description: "SUCK ME : donne un rôle pour une durée, retiré tout seul à la fin",
    usage: "/roletemp donner membre role duree · retirer · liste",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("donner", "Donne un rôle temporaire", [opt(6, "membre", "Membre", { required: true }), opt(8, "role", "Rôle", { required: true }), opt(3, "duree", "Durée : 30m, 12h, 7j…", { required: true, max_length: 20 })]),
      sub("retirer", "Retire un rôle temporaire", [opt(6, "membre", "Membre", { required: true }), opt(8, "role", "Rôle", { required: true })]),
      sub("liste", "Rôles temporaires en cours"),
    ],
  },
  {
    name: "annonce",
    description: "SUCK ME : publie une annonce (tout de suite ou programmée)",
    usage: "/annonce envoyer salon message [titre] [couleur] [mention] [dans] · liste · annuler",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("envoyer", "Publie ou programme une annonce", [
        opt(7, "salon", "Salon", { required: true, channel_types: [0, 5] }),
        opt(3, "message", "Texte (\\n pour aller à la ligne)", { required: true, max_length: 3500 }),
        opt(3, "titre", "Titre", { max_length: 200 }),
        opt(3, "couleur", "Couleur #RRGGBB", { max_length: 7 }),
        opt(8, "mention", "Rôle à mentionner"),
        opt(3, "dans", "Programmer dans : 30m, 2h, 1j…", { max_length: 20 }),
      ]),
      sub("liste", "Annonces programmées"),
      sub("annuler", "Annule une annonce programmée", [opt(4, "id", "Numéro", { required: true, min_value: 1 })]),
    ],
  },
  {
    name: "staff",
    description: "SUCK ME : échelle du staff, promotions, absences",
    usage: "/staff liste · echelle · promouvoir · retrograder · absence · retour",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Le staff par rang, avec les absences"),
      sub("echelle", "Définit l'échelle des rôles du staff (du plus bas au plus haut)", [
        opt(8, "role1", "Rôle", { required: true }), opt(8, "role2", "Rôle"), opt(8, "role3", "Rôle"), opt(8, "role4", "Rôle"), opt(8, "role5", "Rôle"), opt(8, "role6", "Rôle"),
      ]),
      sub("promouvoir", "Fait monter un membre d'un rang", [opt(6, "membre", "Membre", { required: true })]),
      sub("retrograder", "Fait descendre un membre d'un rang", [opt(6, "membre", "Membre", { required: true })]),
      sub("absence", "Déclare ton absence", [opt(3, "raison", "Raison", { max_length: 200 }), opt(3, "duree", "Durée : 3j, 1j12h…", { max_length: 20 })]),
      sub("retour", "Met fin à ton absence"),
    ],
  },
  {
    name: "pseudo",
    description: "SUCK ME : change ou réinitialise le pseudo d'un membre",
    usage: "/pseudo changer membre nom · reset membre",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("changer", "Change le pseudo", [opt(6, "membre", "Membre", { required: true }), opt(3, "nom", "Nouveau pseudo", { required: true, max_length: 32 })]),
      sub("reset", "Remet le pseudo d'origine", [opt(6, "membre", "Membre", { required: true })]),
    ],
  },
  {
    name: "effet",
    description: "FDPDLAVOC : applique un effet audio à la musique",
    usage: "/effet type",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "type", "Effet", { required: true, choices: [
      { name: "Aucun", value: "aucun" }, { name: "Bass boost", value: "bassboost" }, { name: "Nightcore", value: "nightcore" },
      { name: "8D", value: "8d" }, { name: "Rapide", value: "rapide" }, { name: "Lent", value: "lent" },
    ] })],
  },
  {
    name: "playlist",
    description: "FDPDLAVOC : tes playlists enregistrées",
    usage: "/playlist sauver nom · charger nom · liste · supprimer nom",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("sauver", "Enregistre la musique en cours et la file", [opt(3, "nom", "Nom", { required: true, max_length: 40 })]),
      sub("charger", "Lance une de tes playlists", [opt(3, "nom", "Nom", { required: true, max_length: 40 })]),
      sub("liste", "Tes playlists"),
      sub("supprimer", "Supprime une playlist", [opt(3, "nom", "Nom", { required: true, max_length: 40 })]),
    ],
  },
  {
    name: "dj",
    description: "FDPDLAVOC : rôle DJ (contrôle de la musique, vote pour passer)",
    usage: "/dj [role]",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(8, "role", "Rôle DJ (vide = tout le monde contrôle la musique)")],
  },
  {
    name: "undogall",
    description: "Retire toutes les laisses DOG : ce serveur, les anciens serveurs, ou tout",
    usage: "/undogall [portee]",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(3, "portee", "Quelles laisses retirer (par défaut : ce serveur)", { choices: [
        { name: "Ce serveur", value: "serveur" },
        { name: "Anciens serveurs (où le bot n'est plus)", value: "anciens" },
        { name: "Tout", value: "tout" },
      ] }),
    ],
  },

];

const slashRootNames = SLASH_COMMANDS.map((command) => command.name);
if (slashRootNames.length > DISCORD_MAX_ROOT_COMMANDS) {
  throw new Error(`Catalogue Discord invalide : ${slashRootNames.length} commandes racine (maximum ${DISCORD_MAX_ROOT_COMMANDS}).`);
}
if (new Set([...slashRootNames, ...EXTRA_SLASH_COMMANDS.map((command) => command.name)]).size !== slashRootNames.length + EXTRA_SLASH_COMMANDS.length) {
  throw new Error("Catalogue Discord invalide : noms de commandes racine dupliqués.");
}

/** Valid Discord application command payload, including nested subcommands. */
export const toDiscordCommand = (c: SlashCommandDef) => ({
  name: c.name,
  description: c.description,
  type: 1,
  ...(c.defaultMemberPermissions ? { default_member_permissions: c.defaultMemberPermissions } : {}),
  ...(c.dmPermission === false ? { dm_permission: false } : {}),
  ...(c.options?.length ? { options: c.options.map(toDiscordOption) } : {}),
});

function toDiscordOption(o: SlashOption): Record<string, unknown> {
  return {
    type: o.type,
    name: o.name,
    description: o.description,
    ...(o.required !== undefined ? { required: o.required } : {}),
    ...(o.max_length !== undefined ? { max_length: o.max_length } : {}),
    ...(o.min_length !== undefined ? { min_length: o.min_length } : {}),
    ...(o.min_value !== undefined ? { min_value: o.min_value } : {}),
    ...(o.max_value !== undefined ? { max_value: o.max_value } : {}),
    ...(o.channel_types?.length ? { channel_types: o.channel_types } : {}),
    ...(o.choices?.length ? { choices: o.choices } : {}),
    ...(o.options?.length ? { options: o.options.map(toDiscordOption) } : {}),
  };
}

/** Commands grouped by category for the /aide output and the dashboard. */
export function slashCommandsByCategory(): { category: string; commands: SlashCommandDef[] }[] {
  const groups = new Map<string, SlashCommandDef[]>();
  for (const command of SLASH_COMMANDS) {
    const list = groups.get(command.category) ?? [];
    list.push(command);
    groups.set(command.category, list);
  }
  return [...groups.entries()].map(([category, commands]) => ({ category, commands }));
}
