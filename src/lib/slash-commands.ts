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
  /** Discord autocomplete (dynamic choices, e.g. sanction types stored in the central database). */
  autocomplete?: boolean;
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

// MALUS (SUCK ME) : une seule commande racine pour rester sous la limite de 100 commandes par bot.
const MALUS_MESSAGE_SUBS: Array<[string, string]> = [
  ["perroquet", "Ses messages deviennent moqueurs, à l'envers ou en majuscules"],
  ["fantome", "Ses messages disparaissent au bout de 5 s"],
  ["mime", "Il ne peut écrire qu'en émojis"],
  ["clown", "Chacun de ses messages reçoit un 🤡"],
  ["robot", "Ses messages deviennent BIP BOUP"],
  ["bebe", "Ses messages en langage bébé"],
  ["yoda", "Ses mots dans le désordre, hmm"],
  ["chuchote", "Ses messages en tout petits caractères"],
  ["sablier", "Un seul message par minute"],
  ["malediction", "1 message sur 5 remplacé par une phrase gênante"],
];
const MALUS_STOP_CHOICES = [
  ...MALUS_MESSAGE_SUBS.map(([value]) => ({ name: value, value })),
  ...["sourdine-folle", "exil", "bouffon", "taxe", "rancon", "cible"].map((value) => ({ name: value, value })),
].slice(0, 25);
const malusTargetOptions = (): SlashOption[] => [
  opt(6, "membre", "Membre visé", { required: true }),
  opt(4, "minutes", "Durée (1 à 60 min, 10 par défaut)", { min_value: 1, max_value: 60 }),
];

/** The stake option shared by every casino game. */
const MISE = opt(4, "mise", "Mise en PND", { required: true, min_value: 1, max_value: 1000000000 });

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
  "panel", "audit", "add", "annuler", "remove", "permissions", "permissions-edit", "incident",
  { group: "config", description: "Rôles, ADMIN+ et PND Intelligence", members: ["role", "admin-role", "whitelist-role", "intelligence-channel", "intelligence-toggle"] },
  { group: "staff", description: "Responsables et hiérarchie du staff", members: ["supervisor-set", "supervisor-remove", "supervisor-list"] },
  { group: "whitelist", description: "Exemption WHITELIST (propriétaire)", members: ["whitelist-add", "whitelist-remove", "whitelist-list"] },
  { group: "outils", description: "Ghost, composer, recherche, blueprints, clone, studio, packs", members: ["ghost", "composer", "search", "blueprint", "clone", "studio", "pack"] },
  { group: "diagnostic", description: "Audit ACL, santé du bot et couverture des logs (lecture seule)", members: ["acl", "sante", "logs-couverture", "matrice", "economie", "bots", "installation"] },
  { group: "suivi", description: "Fiche d'un membre, notes du staff et activité du staff", members: ["fiche", "stats", "notes", "note-ajouter", "note-retirer", "vote"] },
  { group: "urgence", description: "Gel d'urgence du staff et alertes d'abus du staff", members: ["gel", "degel", "alerte-abus", "double-validation", "auto-gel"] },
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
    name: "ia", description: "Gère ta mémoire et pose des questions sur le fonctionnement du serveur", usage: "/ia memoire etat:activer|desactiver · /ia oublier · /ia question question", category: "Général", dmPermission: false, requiresBotProcess: true,
    options: [
      sub("memoire", "Choisis si le bot peut conserver le contexte de tes conversations", [
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
      sub("question", "Pose une question sur les commandes et le fonctionnement du serveur", [
        opt(3, "question", "Question sans données personnelles ni secrets", { required: true, max_length: 1000 }),
      ]),
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
    name: "tempmute",
    description: "Exclut temporairement un membre avec une sanction prédéfinie (durée automatique)",
    usage: "/tempmute membre sanction [raison]",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à sanctionner", { required: true }),
      opt(3, "sanction", "Sanction prédéfinie : sa durée s'applique automatiquement", { required: true, autocomplete: true, max_length: 20 }),
      opt(3, "raison", "Précision facultative (contexte, message en cause)", { max_length: 300 }),
    ],
  },
  {
    name: "unmute",
    description: "Retire la sourdine d’un membre",
    usage: "/unmute membre [raison]",
    category: "Modération",
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
    usage: "/ban membre raison preuve|capture",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à bannir", { required: true }),
      opt(3, "raison", "Raison", { required: true, max_length: 300 }),
      opt(3, "preuve", "Lien du message ou description précise (preuve obligatoire)", { max_length: 300 }),
      opt(11, "capture", "Capture d'écran de la preuve"),
    ],
  },
  {
    name: "tempban",
    description: "Bannit un membre pour une durée, débanni automatiquement ensuite",
    usage: "/tempban membre duree raison",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à bannir", { required: true }),
      opt(3, "duree", "Durée : 30m, 12h, 7j, 1h30… (365 jours au plus)", { required: true, max_length: 20 }),
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
    usage: "/rolepanel panel | espace | membre | create | rename | color | delete | list | manage",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Ouvre le panneau interactif des rôles personnalisés"),
      sub("espace", "Publie ici le panneau « Rôles personnels — Espace membres »", [
        opt(8, "eligible1", "Rôle autorisé à créer son rôle perso (vide = création par le staff seulement)"),
        opt(8, "eligible2", "Autre rôle autorisé"),
        opt(8, "eligible3", "Autre rôle autorisé"),
      ]),
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
    usage: "/sysp panel|audit|role|add|remove|permissions|whitelist-*|supervisor-*|diagnostic acl|sante|logs-couverture|matrice|economie|bots|installation",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: groupSubcommands([
      sub("panel", "Ouvre le centre de contrôle SYS+"),
      sub("audit", "Affiche les dernières actions staff (filtre par membre ou action)", [opt(6, "membre", "Actions faites par ce membre ou le visant"), opt(3, "action", "Début du nom d’action, ex. whitelist, adminplus", { max_length: 60 })]),
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
      sub("bots", "Bots : quel bot traite chaque domaine en ce moment"),
      sub("installation", "Bilan : permissions et place du rôle de chaque bot, base centrale, sauvegarde"),
      sub("gel", "Owner : suspend toutes les commandes du staff sur les 5 bots, pour une durée", [
        opt(3, "duree", "Durée : 30m, 2h, 1j (7 jours maximum)", { required: true, max_length: 20 }),
        opt(3, "raison", "Raison (visible dans le Logs Hub)", { max_length: 300 }),
        opt(5, "retirer_admin_plus", "Retire aussi le rôle ADMIN+ (rendu au dégel)"),
      ]),
      sub("degel", "Owner : lève le gel du staff tout de suite"),
      sub("fiche", "Fiche complète d'un membre : arrivée, rôles, sanctions des 5 bots, activité", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("stats", "Activité du staff : sanctions, tickets, vocal, refus de quota, inactifs", [
        opt(3, "periode", "Période (7 jours par défaut)", { choices: [{ name: "7 jours", value: "7j" }, { name: "30 jours", value: "30j" }] }),
      ]),
      sub("notes", "Notes privées du staff sur un membre (chaque lecture est journalisée)", [opt(6, "membre", "Membre concerné", { required: true })]),
      sub("note-ajouter", "Ajoute une note privée du staff sur un membre (gardée 1 an, pas de données sensibles)", [
        opt(6, "membre", "Membre concerné", { required: true }),
        opt(3, "texte", "La note (500 caractères maximum)", { required: true, max_length: 500 }),
      ]),
      sub("note-retirer", "Retire une note (son auteur, un SYS+ ou l'owner)", [opt(4, "note", "Numéro de la note", { required: true, min_value: 1 })]),
      sub("alerte-abus", "Alertes MP aux SYS+ si un membre du staff sanctionne en rafale ou s'acharne (owner pour modifier)", [
        opt(5, "active", "Active ou coupe les alertes"),
        opt(4, "rafale", "Nombre de sanctions qui déclenche l'alerte rafale (2 à 100)", { min_value: 2, max_value: 100 }),
        opt(4, "rafale_minutes", "En combien de minutes (1 à 1440)", { min_value: 1, max_value: 1440 }),
        opt(4, "cible", "Nombre de sanctions sur la même personne (2 à 50)", { min_value: 2, max_value: 50 }),
        opt(4, "cible_heures", "En combien d'heures (1 à 720)", { min_value: 1, max_value: 720 }),
      ]),
      sub("annuler", "Annule ta dernière attribution de SYS+ (dans l'heure)"),
      sub("vote", "Vote des SYS+ sur un candidat SYS+ (avis seulement, l'owner décide)", [opt(6, "membre", "Candidat", { required: true }), opt(5, "pour", "Vrai = pour, faux = contre (vide = voir le résultat)")]),
      sub("auto-gel", "Gel automatique du staff quand GUARD repousse une attaque (désactivé par défaut)", [opt(5, "actif", "Vrai = active, faux = désactive (vide = voir l'état)"), opt(4, "minutes", "Durée du gel : 5 à 240 minutes", { min_value: 5, max_value: 240 })]),
      sub("double-validation", "Exige l'accord d'un autre membre SYS+ pour attribuer SYS+", [opt(5, "actif", "Vrai = active, faux = désactive (vide = voir l'état)")]),
      sub("add", "Attribue le rôle SYS+ à un membre (propriétaire)", [opt(6, "membre", "Membre concerné", { required: true }), opt(3, "duree", "Durée du SYS+ : 12h, 7j… (retrait automatique)", { max_length: 20 }), opt(5, "essai", "Période d'essai de 14 jours (confirmation de l'owner requise)"), opt(5, "simuler", "Simuler : vérifie la demande sans rien modifier")]),
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
    usage: "/ticket panel | close | add | remove | list | notes | assign | historique | transcript",
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
      sub("notes", "Staff : note moyenne du support par modérateur (1 à 5)"),
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
      sub("list", "Liste les webhooks gérés par le bot"),
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
    description: "PND Casino : blackjack, roulette, machine à sous, mines, crash et plinko",
    usage: "/casino blackjack | roulette | slots | mines | crash | plinko | jackpot | vip",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("blackjack", "Table de blackjack : doubler, séparer, assurance", [MISE]),
      sub("roulette", "Roulette européenne, plusieurs mises par tour", [opt(3, "mises", "Ex. rouge:500, 17:100, douzaine2:200 — ou juste « rouge »", { required: true, max_length: 100 }), opt(4, "mise", "Mise par défaut si tu ne précises pas de montant", { min_value: 1, max_value: 1000000000 })]),
      sub("slots", "Machine à sous : 5 lignes, joker, scatters et jackpot", [MISE]),
      sub("mines", "Retourne des cases et encaisse avant la bombe", [MISE, opt(4, "bombes", "Nombre de mines cachées (1 à 24, défaut 3)", { min_value: 1, max_value: 24 })]),
      sub("crash", "La courbe monte, encaisse avant qu'elle lâche", [MISE, opt(10, "auto", "Encaissement automatique, ex. 2.5", { min_value: 1.01, max_value: 1000 })]),
      sub("plinko", "Lâche une bille sur 16 rangées", [MISE, opt(3, "risque", "Niveau de risque", { choices: [{ name: "Faible", value: "faible" }, { name: "Moyen", value: "moyen" }, { name: "Fort", value: "fort" }] })]),
      sub("coinflip", "Joue à pile ou face", [MISE, opt(3, "choix", "pile ou face", { required: true, choices: [{ name: "Pile", value: "pile" }, { name: "Face", value: "face" }] })]),
      sub("dice", "Parie sur une face du dé", [MISE, opt(3, "choix", "Face attendue (1 à 6)", { required: true, choices: [1,2,3,4,5,6].map((n) => ({ name: String(n), value: String(n) })) })]),
      sub("jackpot", "Affiche la cagnotte progressive du serveur"),
      sub("vip", "Consulte ton rang VIP et ton cashback"),
      sub("cashback", "Récupère le cashback de tes pertes de la veille"),
      sub("classement", "Classement des joueurs du serveur"),
      sub("stats", "Consulte tes statistiques Casino"),
      sub("historique", "Consulte tes dernières parties"),
      sub("regles", "Règles et taux de paiement de chaque jeu"),
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
      opt(5, "test", "Simulation : montre le parcours sans déplacer personne"),
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
    name: "dogall",
    description: "SYS+ : met en laisse tous les membres de ton salon vocal (dans la limite de tes laisses)",
    usage: "/dogall",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [],
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
    name: "heure",
    description: "Heure locale des membres (chacun indique son fuseau)",
    usage: "/heure voir [membre] | regler fuseau",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Heure chez un membre", [opt(6, "membre", "Membre (toi par défaut)")]),
      sub("regler", "Indique ton fuseau horaire", [opt(3, "fuseau", "Ex. Europe/Paris, America/Montreal", { required: true, max_length: 60 })]),
    ],
  },
  { name: "citation", description: "Transforme un message en belle citation", usage: "/citation lien", category: "Général", dmPermission: false, requiresBotProcess: true,
    options: [opt(3, "lien", "Lien du message (clic droit → Copier le lien)", { required: true, max_length: 200 })] },
  { name: "archive", description: "Staff : archive les derniers messages d'un salon en fichier", usage: "/archive [salon] [messages]", category: "Modération", dmPermission: false, requiresBotProcess: true,
    options: [opt(7, "salon", "Salon (celui-ci par défaut)", { channel_types: [0] }), opt(4, "messages", "Nombre (10 à 500, 200 par défaut)", { min_value: 10, max_value: 500 })] },
  { name: "resume-salon", description: "Résumé par l'IA de ce que tu as raté dans un salon public", usage: "/resume-salon [salon] [heures]", category: "Général", dmPermission: false, requiresBotProcess: true,
    options: [opt(7, "salon", "Salon (celui-ci par défaut)", { channel_types: [0] }), opt(4, "heures", "Fenêtre (1 à 24 h, 3 par défaut)", { min_value: 1, max_value: 24 })] },
  { name: "salon-temp", description: "Crée un salon texte supprimé tout seul après l'événement", usage: "/salon-temp nom [heures]", category: "Administration & sécurité", dmPermission: false, requiresBotProcess: true,
    options: [opt(3, "nom", "Nom du salon", { required: true, max_length: 90 }), opt(4, "heures", "Durée (1 à 168 h, 24 par défaut)", { min_value: 1, max_value: 168 })] },
  { name: "sante", description: "Staff : état des 6 bots", usage: "/sante", category: "Administration & sécurité", dmPermission: false, requiresBotProcess: true, options: [] },
  {
    name: "defi",
    description: "Défi collectif de la semaine : un objectif commun récompensé",
    usage: "/defi etat | lancer messages [recompense]",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Où en est le défi de la semaine"),
      sub("lancer", "Lance le défi de la semaine (Gérer le serveur)", [
        opt(4, "messages", "Objectif de messages (100 à 100 000)", { required: true, min_value: 100, max_value: 100000 }),
        opt(4, "recompense", "PND par participant (10 à 1 000, 100 par défaut)", { min_value: 10, max_value: 1000 }),
      ]),
    ],
  },
  { name: "export-config", description: "Owner : reçois toute la configuration du serveur en fichier", usage: "/export-config", category: "Administration & sécurité", dmPermission: false, requiresBotProcess: true, options: [] },
  {
    name: "vocal-plus",
    description: "Préréglages de ton vocal temporaire et classement du temps en vocal",
    usage: "/vocal-plus classement | preset-sauver | preset-charger | preset-liste | preset-supprimer",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("classement", "Top 10 du temps en vocal", [opt(3, "periode", "Période", { choices: [{ name: "Cette semaine", value: "semaine" }, { name: "30 jours", value: "mois" }, { name: "Depuis le début", value: "total" }] })]),
      sub("preset-sauver", "Enregistre le nom et la limite de ton vocal actuel", [opt(3, "nom", "Nom du préréglage", { required: true, max_length: 30 })]),
      sub("preset-charger", "Applique un préréglage à ton vocal", [opt(3, "nom", "Nom du préréglage", { required: true, max_length: 30 })]),
      sub("preset-liste", "Tes préréglages"),
      sub("preset-supprimer", "Supprime un préréglage", [opt(3, "nom", "Nom du préréglage", { required: true, max_length: 30 })]),
    ],
  },
  {
    name: "garde",
    description: "SYS+ : tes outils de garde (relève, astreinte, enquête, appel, gel d'un salon…)",
    usage: "/garde moi | releve | astreinte | enquete | bareme | appel | geler | demande-quota | bilan | planning",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("moi", "Ton quota, tes sanctions récentes, tes malus actifs"),
      sub("releve", "Résumé des dernières heures pour prendre la suite", [opt(4, "heures", "Fenêtre (1 à 72 h, 12 par défaut)", { min_value: 1, max_value: 72 })]),
      sub("astreinte", "Te déclarer d'astreinte : les alertes de sécurité t'arrivent en privé", [
        opt(3, "etat", "Choix", { required: true, choices: [{ name: "Je prends l'astreinte", value: "on" }, { name: "Je termine", value: "off" }, { name: "Qui est d'astreinte ?", value: "liste" }] }),
      ]),
      sub("enquete", "Arrivée, invitation, vocal, casier et barème d'un membre", [opt(6, "membre", "Membre", { required: true })]),
      sub("bareme", "Sanction suivante proposée selon le casier", [opt(6, "membre", "Membre", { required: true })]),
      sub("appel", "Vote rapide des SYS+ avant une sanction lourde", [
        opt(6, "membre", "Membre concerné", { required: true }),
        opt(3, "sanction", "Sanction envisagée", { required: true, max_length: 80 }),
        opt(3, "raison", "Motif", { required: true, max_length: 300 }),
      ]),
      sub("geler", "Couper l'écriture d'un salon pendant une dispute, réouverture automatique", [
        opt(7, "salon", "Salon (celui-ci par défaut)", { channel_types: [0] }),
        opt(4, "minutes", "Durée (1 à 120 min, 10 par défaut)", { min_value: 1, max_value: 120 }),
      ]),
      sub("demande-quota", "Demander à l'owner quelques sanctions de plus", [
        opt(4, "nombre", "Sanctions en plus (1 à 20)", { required: true, min_value: 1, max_value: 20 }),
        opt(3, "raison", "Pourquoi", { required: true, max_length: 300 }),
      ]),
      sub("bilan", "Ton bilan de la semaine (aussi envoyé le dimanche soir)"),
      sub("planning", "Planning du staff : indique tes dispos ou vois celles de tous", [opt(3, "dispos", "Tes disponibilités (ex. lun-ven 18h-23h) ; vide = voir le planning", { max_length: 120 })]),
    ],
  },
  {
    name: "malus",
    description: "SYS+ : malus temporaires sur un membre (perroquet, fantôme, mime, clown…)",
    usage: "/malus <type> membre [minutes] | stop membre [type] | liste",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      ...MALUS_MESSAGE_SUBS.map(([name, description]) => sub(name, description, malusTargetOptions())),
      sub("sourdine-folle", "En vocal, son micro coupé et rendu au hasard (5 min au plus)", malusTargetOptions()),
      sub("exil", "Renvoyé dans le salon AFK à chaque connexion vocale", malusTargetOptions()),
      sub("bouffon", "Rôle « Bouffon du serveur » affiché à part (aucune permission)", malusTargetOptions()),
      sub("roulette-vocale", "Un membre de ton salon vocal, tiré au sort, est rendu muet 1 min"),
      sub("patate", "Patate chaude : à passer en mentionnant quelqu'un en 30 s", [opt(6, "membre", "Premier à recevoir la patate", { required: true })]),
      sub("tribunal", "Vote public de 60 s : coupable ou innocent", [opt(6, "membre", "Accusé", { required: true })]),
      sub("interrogatoire", "3 questions, 30 s pour répondre à chacune", [opt(6, "membre", "Membre interrogé", { required: true })]),
      sub("taxe", "30 % de ses gains de PND vont au SYS+", malusTargetOptions()),
      sub("rancon", "Muet jusqu'à ce que quelqu'un paie la rançon", [
        opt(6, "membre", "Membre pris en otage", { required: true }),
        opt(4, "montant", "Rançon en PND (10 à 100 000)", { required: true, min_value: 10, max_value: 100000 }),
        opt(4, "minutes", "Durée maximale (1 à 60 min, 10 par défaut)", { min_value: 1, max_value: 60 }),
      ]),
      sub("cible", "Chaque membre qui le mentionne gagne 25 PND", malusTargetOptions()),
      sub("payer-rancon", "Paie la rançon d'un membre pour le libérer", [opt(6, "membre", "Otage à libérer", { required: true })]),
      sub("stop", "Lève les malus d'un membre", [
        opt(6, "membre", "Membre", { required: true }),
        opt(3, "type", "Un seul malus (vide = tous)", { choices: MALUS_STOP_CHOICES }),
      ]),
      sub("liste", "Malus actifs sur le serveur"),
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
      sub("cooldown", "Règle l’intervalle minimum des réponses", [opt(4, "secondes", "Durée entre 2 et 300 secondes", { required: true, min_value: 2, max_value: 300 })]),
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

  // ── Accès et confidentialité vocale — racine regroupée ─────────────────────
  {
    name: "voice",
    description: "Gère les accès et la confidentialité des salons vocaux",
    usage: "/voice access grant|revoke · /voice private activer|liste|retirer",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: groupSubcommands([
      sub("grant", "Autorise un membre à rejoindre ton salon vocal", [opt(6, "membre", "Membre à autoriser", { required: true })]),
      sub("revoke", "Retire l’accès d’un membre à ton salon vocal", [opt(6, "membre", "Membre à retirer de la liste d’accès", { required: true })]),
      sub("activer", "Rend ton salon vocal actuel privé"),
      sub("liste", "Liste les salons privatisés du serveur"),
      sub("retirer", "Rétablit les permissions d’origine de ton salon vocal"),
    ], [
      { group: "access", description: "Gère les autorisations d’accès", members: ["grant", "revoke"] },
      { group: "private", description: "Gère les salons vocaux privés", members: ["activer", "liste", "retirer"] },
    ]),
  },
  // Raccourcis rétablis le 27/11 (demande de l'owner) : /pv et /unpv, comme ;pv et ;unpv.
  {
    name: "pv",
    description: "Rend privé le salon vocal où tu te trouves",
    usage: "/pv",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "unpv",
    description: "Rétablit les permissions d’origine de ton salon vocal privé",
    usage: "/unpv",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
  },

    {
    name: "panel",
    description: "Ouvre le centre de contrôle",
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
    usage: "/voc panel | vocal-panel | demander | demander-id | limit | name | claim | expulser | inviter | transferer | lock | unlock | delete | confiance | bloquer | retirer | listes",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Affiche le panneau de contrôle du salon temporaire"),
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
      sub("confiance", "Ajoute un membre de confiance : il entre toujours dans tes salons", [opt(6, "membre", "Membre", { required: true })]),
      sub("bloquer", "Bloque un membre : il ne peut plus entrer dans tes salons", [opt(6, "membre", "Membre", { required: true })]),
      sub("retirer", "Retire un membre de ta liste de confiance ou de blocage", [opt(6, "membre", "Membre", { required: true })]),
      sub("listes", "Affiche tes membres de confiance et tes membres bloqués"),
    ],
  },

  // ── Musique — une seule racine, toutes les actions conservées ───────────────
  {
    name: "music",
    description: "Contrôle la lecture, la file et le lecteur vocal",
    usage: "/music player play|pause|resume|skip|stop|queue|nowplaying|volume|loop|shuffle|clearqueue|remove|join|leave|panel",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: groupSubcommands([
      sub("play", "Joue un lien YouTube/SoundCloud ou recherche un titre", [opt(3, "recherche", "Lien YouTube/SoundCloud ou titre à rechercher", { required: true, max_length: 500 })]),
      sub("recherche", "Cherche un titre et choisis parmi 5 résultats", [opt(3, "titre", "Titre, artiste…", { required: true, max_length: 200 })]),
      sub("pause", "Met la musique en pause"),
      sub("resume", "Reprend la lecture de la musique"),
      sub("skip", "Passe au titre suivant"),
      sub("stop", "Arrête la musique et vide la file"),
      sub("queue", "Affiche la file d’attente musicale"),
      sub("nowplaying", "Affiche le titre en cours de lecture"),
      sub("volume", "Règle le volume de la musique", [opt(4, "niveau", "Volume entre 0 et 100", { required: true, min_value: 0, max_value: 100 })]),
      sub("loop", "Change le mode de répétition", [opt(3, "mode", "Mode de répétition", {
        choices: [
          { name: "Désactivée", value: "off" },
          { name: "Titre", value: "track" },
          { name: "File", value: "queue" },
          { name: "Auto (titres proches à la fin de la file)", value: "auto" },
        ],
      })]),
      sub("shuffle", "Mélange la file d’attente musicale"),
      sub("clearqueue", "Vide la file d’attente musicale"),
      sub("remove", "Retire un titre de la file d’attente", [opt(4, "position", "Position du titre dans /music player queue", { required: true, min_value: 1, max_value: 100 })]),
      sub("join", "Connecte le bot à ton salon vocal"),
      sub("leave", "Déconnecte le bot du salon vocal"),
      sub("panel", "Affiche le panneau de contrôle musical"),
    ], [
      { group: "player", description: "Lecture, file d’attente et contrôles du lecteur", members: [
        "play", "recherche", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume",
        "loop", "shuffle", "clearqueue", "remove", "join", "leave", "panel",
      ] },
    ]),
  },

  // ── Radio PND ──────────────────────────────────────────────────────────────
  {
    name: "radio",
    description: "Gère la radio PND 24/7 et ses hôtes autorisés",
    usage: "/radio status | station | set | host-add | host-remove | host-list | start | stop | clear",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("status", "Affiche l’état de la radio"),
      sub("set", "Configure et lance la radio (administration)", [
        opt(7, "salon", "Salon vocal de diffusion", { required: true, channel_types: [2] }),
        opt(3, "source", "URL de flux audio HTTPS direct", { required: true, max_length: 2000 }),
      ]),
      sub("station", "Lance une station prête à l'emploi (FIP, Mouv', France Inter…)", [
        opt(7, "salon", "Salon vocal de diffusion", { required: true, channel_types: [2] }),
        opt(3, "station", "Station", { required: true, choices: [
          { name: "FIP", value: "fip" }, { name: "FIP Rock", value: "fip-rock" }, { name: "FIP Jazz", value: "fip-jazz" },
          { name: "FIP Groove", value: "fip-groove" }, { name: "FIP Electro", value: "fip-electro" }, { name: "Mouv'", value: "mouv" }, { name: "France Inter", value: "franceinter" },
        ] }),
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
/** Commandes soumises aux quotas (doit rester identique à bot/shared/quotas.js). */
export const QUOTA_COMMAND_NAMES = ["tempmute", "unmute", "warn", "kick", "ban", "unban", "blacklist", "mv"] as const;
const QUOTA_COMMAND_CHOICES: SlashOptionChoice[] = QUOTA_COMMAND_NAMES.map((name) => ({ name, value: name }));
const MODERATION_TIER_CHOICES: SlashOptionChoice[] = [
  { name: "1 % · All Access", value: 1 },
  { name: "5 % · Administrateur", value: 5 },
  { name: "10 % · Modérateur", value: 10 },
  { name: "50 % · Modérateur test", value: 50 },
];
const ALL_TIER_CHOICES: SlashOptionChoice[] = [
  { name: "0 % · Owner", value: 0 },
  ...MODERATION_TIER_CHOICES,
  { name: "70 %", value: 70 },
  { name: "80 %", value: 80 },
  { name: "100 %", value: 100 },
];

export const EXTRA_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: "outils",
    description: "Outils staff : message collé en bas d'un salon et modmail (MP au staff)",
    usage: "/outils sticky definir|retirer|liste · /outils modmail config|etat|repondre|fermer|bloquer|debloquer|desactiver",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      {
        type: 2, name: "sticky", description: "Message toujours affiché en bas d'un salon",
        options: [
          sub("definir", "Colle un message en bas d'un salon (remplace l'ancien)", [
            opt(7, "salon", "Salon", { required: true, channel_types: [0, 5] }),
            opt(3, "texte", "Texte du message (\\n pour aller à la ligne)", { required: true, max_length: 1500 }),
          ]),
          sub("retirer", "Retire le message collé d'un salon", [opt(7, "salon", "Salon", { required: true, channel_types: [0, 5] })]),
          sub("liste", "Les messages collés du serveur"),
        ],
      },
      {
        type: 2, name: "modmail", description: "Les membres écrivent en MP au bot, le staff répond dans un fil",
        options: [
          sub("repondre", "Dans un fil modmail : envoie une réponse en MP au membre", [
            opt(3, "message", "Ta réponse", { required: true, max_length: 1800 }),
            opt(5, "anonyme", "Signer « Staff du serveur » au lieu de ton nom (réglage du serveur par défaut)"),
          ]),
          sub("fermer", "Dans un fil modmail : ferme la conversation", [opt(3, "raison", "Raison montrée au membre", { max_length: 300 })]),
          sub("config", "Staff : salon privé où arrivent les conversations", [
            opt(7, "salon", "Salon réservé au staff", { required: true, channel_types: [0] }),
            opt(5, "anonyme", "Réponses signées « Staff du serveur » (oui par défaut)"),
          ]),
          sub("etat", "Le modmail est-il activé ?"),
          sub("bloquer", "Staff : empêche un membre d'écrire au staff", [opt(6, "membre", "Membre", { required: true })]),
          sub("debloquer", "Staff : autorise de nouveau un membre", [opt(6, "membre", "Membre", { required: true })]),
          sub("desactiver", "Staff : arrête le modmail"),
        ],
      },
    ],
  },
  {
    name: "anim",
    description: "Animation du serveur : salon de comptage, mur des célébrités, question du jour",
    usage: "/anim comptage salon|etat|classement|desactiver · /anim vedette config|etat|desactiver · /anim qdj config|etat|ajouter|maintenant|sans_role|desactiver",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      {
        type: 2, name: "comptage", description: "Salon où l'on compte 1, 2, 3… chacun son tour",
        options: [
          sub("etat", "Où en est le comptage, et le record"),
          sub("classement", "Les meilleurs compteurs du serveur"),
          sub("salon", "Staff : choisit le salon de comptage et l'active", [opt(7, "salon", "Salon de comptage", { required: true, channel_types: [0] })]),
          sub("desactiver", "Staff : arrête le comptage (le record est gardé)"),
        ],
      },
      {
        type: 2, name: "vedette", description: "Mur des célébrités : les messages les plus étoilés",
        options: [
          sub("etat", "Réglages et statistiques du mur"),
          sub("config", "Staff : salon du mur, emoji et nombre d'étoiles", [
            opt(7, "salon", "Salon où les messages sont recopiés", { required: true, channel_types: [0, 5] }),
            opt(3, "emoji", "Emoji qui compte (⭐ par défaut)", { max_length: 64 }),
            opt(4, "seuil", "Nombre d'étoiles nécessaires (3 par défaut)", { min_value: 1, max_value: 50 }),
            opt(5, "auto_etoile", "L'auteur peut-il voter pour son propre message ? (non par défaut)"),
          ]),
          sub("desactiver", "Staff : arrête le mur (les messages publiés restent)"),
        ],
      },
      {
        type: 2, name: "qdj", description: "Une question publiée chaque jour, avec un fil pour répondre",
        options: [
          sub("etat", "Réglages de la question du jour"),
          sub("config", "Staff : salon, heure (Paris), rôle mentionné et fil", [
            opt(7, "salon", "Salon de la question du jour", { required: true, channel_types: [0, 5] }),
            opt(4, "heure", "Heure de publication, heure de Paris (18 par défaut)", { min_value: 0, max_value: 23 }),
            opt(8, "role", "Rôle mentionné à chaque question"),
            opt(5, "fil", "Ouvrir un fil de réponses (oui par défaut)"),
          ]),
          sub("ajouter", "Staff : ajoute une question, publiée avant les questions intégrées", [
            opt(3, "question", "La question", { required: true, min_length: 5, max_length: 300 }),
          ]),
          sub("maintenant", "Staff : publie la question du jour tout de suite"),
          sub("sans_role", "Staff : ne plus mentionner de rôle"),
          sub("desactiver", "Staff : arrête la question du jour"),
        ],
      },
    ],
  },
  {
    name: "jeu",
    description: "Jeux entre membres : morpion et puissance 4 (mise en PND possible), pendu en groupe",
    usage: "/jeu morpion @adversaire [mise] · /jeu puissance4 @adversaire [mise] · /jeu pendu · /jeu stats [membre] · /jeu classement jeu",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("morpion", "Défie un membre au morpion", [
        opt(6, "adversaire", "Le membre que tu défies", { required: true }),
        opt(4, "mise", "Mise en PND de chaque joueur (0 = amical)", { min_value: 0, max_value: 100000 }),
      ]),
      sub("puissance4", "Défie un membre au puissance 4", [
        opt(6, "adversaire", "Le membre que tu défies", { required: true }),
        opt(4, "mise", "Mise en PND de chaque joueur (0 = amical)", { min_value: 0, max_value: 100000 }),
      ]),
      sub("pendu", "Lance un pendu dans ce salon : tout le monde peut jouer"),
      sub("stats", "Victoires, défaites et nuls d'un membre", [opt(6, "membre", "Membre (toi par défaut)")]),
      sub("classement", "Les meilleurs joueurs du serveur", [
        opt(3, "jeu", "Jeu", { required: true, choices: [{ name: "Morpion", value: "morpion" }, { name: "Puissance 4", value: "puissance4" }, { name: "Pendu", value: "pendu" }] }),
      ]),
    ],
  },
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
    usage: "/automod etat | natif | regle | mot-ajouter | mot-retirer | exempter | retirer-exemption",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Affiche les règles de l'automod"),
      sub("natif", "Crée les règles AutoMod natives de Discord (marchent même si les bots sont hors ligne)"),
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
    usage: "/casier voir membre · /casier supprimer affaire motif",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Affiche le casier d'un membre", [opt(6, "membre", "Membre", { required: true })]),
      sub("supprimer", "SYS+ : retire une affaire du casier (archivée, avec un motif)", [opt(4, "affaire", "Numéro de l'affaire", { required: true, min_value: 1 }), opt(3, "motif", "Pourquoi l'affaire est retirée", { required: true, max_length: 300 })]),
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
    name: "avantage",
    description: "Dépense tes PND pour des avantages valables dans tous les bots",
    usage: "/avantage liste | acheter | mes-avantages",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Tous les avantages et leur prix"),
      sub("acheter", "Achète un avantage", [
        opt(3, "avantage", "Avantage à acheter", { required: true, choices: [{ name: "Boost d'XP", value: "xp_boost" }, { name: "Protection anti-vol", value: "anti_vol" }, { name: "Couleur de pseudo", value: "couleur" }, { name: "Droit DJ", value: "dj" }, { name: "Plafond de mise doublé", value: "vip_casino" }] }),
        opt(3, "couleur", "Couleur au format #rrggbb (pour la couleur de pseudo)", { max_length: 7 }),
      ]),
      sub("mes-avantages", "Tes avantages actifs"),
    ],
  },
  {
    name: "bouclier",
    description: "Salon piège, sauvegardes du serveur et verrouillage d'urgence",
    usage: "/bouclier piege | sauvegarder | restaurer | verrouiller | etat",
    category: "Administration",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Ce que le bouclier protège en ce moment"),
      sub("piege", "Arme un salon piège anti-robot", [
        opt(3, "action", "Sanction appliquée à qui y écrit", { choices: [
          { name: "Mettre en quarantaine (recommandé)", value: "quarantaine" },
          { name: "Signaler seulement", value: "signaler" },
          { name: "Expulser", value: "expulser" },
          { name: "Bannir", value: "bannir" },
        ] }),
        opt(7, "salon", "Salon existant à utiliser (sinon le bot en crée un)"),
      ]),
      sub("piege-off", "Désarme le salon piège"),
      sub("sauvegarder", "Enregistre la structure du serveur", [opt(3, "nom", "Nom de la sauvegarde", { max_length: 40 })]),
      sub("sauvegardes", "Liste les sauvegardes disponibles"),
      sub("restaurer", "Aperçu puis restauration d'une sauvegarde", [opt(4, "sauvegarde", "Numéro de la sauvegarde", { required: true, min_value: 1 })]),
      sub("verrouiller", "Ferme tous les salons à l'écriture", [opt(3, "raison", "Raison affichée dans le journal", { max_length: 200 })]),
      sub("deverrouiller", "Rouvre les salons que le verrouillage avait fermés"),
    ],
  },
  {
    name: "quete",
    description: "Tes trois quêtes du jour et leurs récompenses",
    usage: "/quete",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [],
  },
  {
    name: "clan",
    description: "Fonde ou rejoins un clan : coffre commun, points et classement",
    usage: "/clan creer | inviter | rejoindre | info | liste | depot | retrait",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("creer", "Fonde un clan (50 000 PND)", [
        opt(3, "nom", "Nom du clan (3 à 32 caractères)", { required: true, max_length: 32 }),
        opt(3, "tag", "Tag court, 2 à 5 lettres ou chiffres", { required: true, max_length: 5 }),
      ]),
      sub("inviter", "Invite un membre dans ton clan", [opt(6, "membre", "Membre à inviter", { required: true })]),
      sub("rejoindre", "Rejoins un clan qui t'a invité", [opt(3, "tag", "Tag du clan", { required: true, max_length: 5 })]),
      sub("quitter", "Quitte ton clan"),
      sub("info", "Fiche d'un clan", [opt(3, "tag", "Tag du clan (le tien par défaut)", { max_length: 5 })]),
      sub("liste", "Classement des clans du serveur", [opt(3, "classement", "Points de saison ou points à vie", { choices: [{ name: "Saison en cours", value: "season" }, { name: "Depuis toujours", value: "total" }] })]),
      sub("depot", "Verse des PND au coffre du clan", [opt(4, "montant", "Montant en PND", { required: true, min_value: 1, max_value: 1000000000 })]),
      sub("retrait", "Retire des PND du coffre (chef)", [opt(4, "montant", "Montant en PND", { required: true, min_value: 1, max_value: 1000000000 })]),
      sub("promouvoir", "Change le rang d'un membre (chef)", [
        opt(6, "membre", "Membre concerné", { required: true }),
        opt(3, "rang", "Nouveau rang", { required: true, choices: [{ name: "Membre", value: "membre" }, { name: "Officier", value: "officier" }, { name: "Chef (transmet la direction)", value: "chef" }] }),
      ]),
      sub("exclure", "Exclut un membre du clan", [opt(6, "membre", "Membre à exclure", { required: true })]),
      sub("dissoudre", "Dissout le clan et récupère le coffre (chef)"),
    ],
  },
  {
    name: "saison",
    description: "Saison en cours, classements et palmarès",
    usage: "/saison etat | palmares | demarrer | cloturer",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "Saison en cours et classement des clans"),
      sub("palmares", "Palmarès des saisons passées", [opt(3, "tableau", "Tableau à consulter", { choices: [{ name: "Clans", value: "clans" }, { name: "Membres", value: "membres" }, { name: "Casino", value: "casino" }] })]),
      sub("demarrer", "Lance une saison (staff)", [
        opt(3, "nom", "Nom de la saison", { max_length: 40 }),
        opt(4, "semaines", "Durée en semaines (13 par défaut)", { min_value: 1, max_value: 52 }),
      ]),
      sub("cloturer", "Clôture la saison et inscrit les podiums (staff)"),
    ],
  },
  {
    name: "moi",
    description: "Ton profil complet : niveau, argent, casino, confiance et casier",
    usage: "/moi [membre]",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Voir le profil d'un autre membre")],
  },
  {
    name: "fwu",
    description: "Vue d'ensemble des cinq bots et de leur état",
    usage: "/fwu",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [],
  },
  {
    name: "confession",
    description: "Envoie une confession anonyme : texte, image ou note vocale",
    usage: "/confession envoyer | config | bloquer | debloquer | stats",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("envoyer", "Envoie une confession anonyme", [
        opt(3, "texte", "Ce que tu veux dire (facultatif si tu joins un fichier)", { max_length: 1500 }),
        opt(11, "image", "Image à joindre (PNG, JPEG, GIF ou WEBP, 8 Mo max)"),
        opt(11, "vocal", "Note vocale à joindre (MP3, OGG, WAV, M4A ou WEBM, 8 Mo max)"),
      ]),
      sub("config", "Configure les confessions (staff)", [
        opt(7, "salon", "Salon où les confessions sont publiées"),
        opt(7, "salon_moderation", "Salon privé où le staff relit et voit les auteurs"),
        opt(5, "moderation", "Relire avant publication (recommandé)"),
        opt(4, "confiance_minimale", "Score de confiance requis (0 à 100)", { min_value: 0, max_value: 100 }),
        opt(4, "par_jour", "Confessions maximum par membre et par jour", { min_value: 1, max_value: 20 }),
      ]),
      sub("bloquer", "Empêche un membre de confesser (staff)", [opt(6, "membre", "Membre à bloquer", { required: true }), opt(3, "raison", "Raison", { max_length: 200 })]),
      sub("debloquer", "Rend l'accès aux confessions à un membre (staff)", [opt(6, "membre", "Membre à débloquer", { required: true })]),
      sub("stats", "Statistiques des confessions du serveur"),
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
    name: "ui",
    description: "Fiche d'un membre : abonnement, boost, vocal, dates, rôles",
    usage: "/ui [membre]",
    category: "Utilitaires",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre (vide = toi)")],
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
    name: "abonnement",
    description: "Invest + : ton abonnement, tes avantages et ton espace privé",
    usage: "/abonnement voir · formules · historique · offrir · espace · demande",
    category: "Invest +",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Ton abonnement : formule, échéance, avantages"),
      sub("formules", "Les formules proposées (et le paiement en PND quand il est possible)"),
      sub("historique", "L'historique de ton abonnement"),
      sub("offrir", "Offre une formule payable en PND à un autre membre", [
        opt(6, "membre", "Le membre qui reçoit le cadeau", { required: true }),
        opt(3, "formule", "Formule offerte (nom ou numéro)", { required: true, max_length: 40 }),
      ]),
      sub("espace", "Ouvre (ou retrouve) ton salon privé Invest +"),
      sub("auto", "Renouvellement automatique en PND à l'échéance", [opt(3, "etat", "Choix", { choices: [{ name: "Activer", value: "on" }, { name: "Couper", value: "off" }] })]),
      sub("demande", "Écris à l'administration (renouvellement, changement, question)", [
        opt(3, "type", "Objet de la demande", { required: true, choices: [{ name: "Renouveler", value: "renouveler" }, { name: "Changer de formule", value: "changer" }, { name: "Question", value: "question" }] }),
        opt(3, "formule", "Formule concernée (nom ou numéro)", { max_length: 40 }),
        opt(3, "message", "Ton message", { max_length: 500 }),
      ]),
    ],
  },
  {
    name: "investadmin",
    description: "Invest + : administration des formules, abonnés et espaces",
    usage: "/investadmin installer · tableau · formule-creer · attribuer · prolonger · resilier · demandes…",
    category: "Invest +",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("installer", "Crée la catégorie des espaces et le salon d'administration"),
      sub("tableau", "Tableau de bord : abonnés, échéances, demandes, revenus"),
      sub("config", "Réglages d'Invest +", [
        opt(5, "actif", "Invest + activé"),
        opt(7, "categorie", "Catégorie des espaces membres", { channel_types: [4] }),
        opt(7, "salon_admin", "Salon d'administration (demandes, journal)", { channel_types: [0] }),
        opt(8, "role_staff", "Rôle qui voit les espaces membres (facultatif)"),
        opt(4, "rappel_jours", "Rappel avant échéance, en jours (0 = aucun)", { min_value: 0, max_value: 30 }),
        opt(3, "accueil", "Texte d'accueil du panneau membre", { max_length: 900 }),
        opt(3, "paiement_infos", "Comment payer en réel (montré au membre qui demande une formule)", { max_length: 900 }),
      ]),
      sub("formules", "Toutes les formules, archivées comprises"),
      sub("formule-creer", "Crée une formule", [
        opt(3, "nom", "Nom de la formule", { required: true, max_length: 40 }),
        opt(4, "prix", "Prix par période (0 = gratuit)", { required: true, min_value: 0, max_value: 1000000000 }),
        opt(4, "duree", "Durée d'une période, en jours", { required: true, min_value: 1, max_value: 3650 }),
        opt(3, "paiement", "Comment la formule est payée", { choices: [{ name: "Paiement réel (activée en un clic par l'admin)", value: "manuel" }, { name: "En PND (payée par le membre)", value: "pnd" }, { name: "Au choix : PND ou paiement réel", value: "mixte" }] }),
        opt(3, "prix_reel", "Prix en argent réel affiché (ex. 9,99 € / mois)", { max_length: 60 }),
        opt(8, "role", "Rôle donné aux abonnés (jamais un rôle protégé)"),
        opt(3, "description", "À quoi sert la formule", { max_length: 300 }),
        opt(3, "avantages", "Avantages, séparés par ;", { max_length: 900 }),
      ]),
      sub("formule-modifier", "Modifie une formule", [
        opt(3, "formule", "Formule (nom ou numéro)", { required: true, max_length: 40 }),
        opt(3, "nom", "Nouveau nom", { max_length: 40 }),
        opt(4, "prix", "Nouveau prix", { min_value: 0, max_value: 1000000000 }),
        opt(4, "duree", "Nouvelle durée en jours", { min_value: 1, max_value: 3650 }),
        opt(3, "paiement", "Mode de paiement", { choices: [{ name: "Paiement réel", value: "manuel" }, { name: "En PND", value: "pnd" }, { name: "Au choix : PND ou réel", value: "mixte" }] }),
        opt(3, "prix_reel", "Prix en argent réel affiché (ex. 9,99 € / mois)", { max_length: 60 }),
        opt(8, "role", "Nouveau rôle des abonnés"),
        opt(5, "retirer_role", "Ne plus donner de rôle"),
        opt(3, "description", "Nouvelle description", { max_length: 300 }),
        opt(3, "avantages", "Nouveaux avantages, séparés par ;", { max_length: 900 }),
      ]),
      sub("formule-archiver", "Ne plus proposer une formule (les abonnés la gardent)", [opt(3, "formule", "Formule (nom ou numéro)", { required: true, max_length: 40 })]),
      sub("formule-reactiver", "Proposer de nouveau une formule archivée", [opt(3, "formule", "Formule (nom ou numéro)", { required: true, max_length: 40 })]),
      sub("attribuer", "Donne une formule à un membre", [
        opt(6, "membre", "Membre", { required: true }),
        opt(3, "formule", "Formule (nom ou numéro)", { required: true, max_length: 40 }),
        opt(4, "jours", "Durée en jours (vide = durée de la formule, 0 = sans fin)", { min_value: 0, max_value: 3650 }),
        opt(3, "note", "Note interne (visible par l'admin seulement)", { max_length: 200 }),
      ]),
      sub("prolonger", "Ajoute des jours à l'abonnement d'un membre", [opt(6, "membre", "Membre", { required: true }), opt(4, "jours", "Jours à ajouter", { required: true, min_value: 1, max_value: 3650 })]),
      sub("pause", "Met un abonnement en pause (les jours restants sont gardés)", [opt(6, "membre", "Membre", { required: true })]),
      sub("reprendre", "Reprend un abonnement en pause", [opt(6, "membre", "Membre", { required: true })]),
      sub("resilier", "Résilie un abonnement tout de suite", [opt(6, "membre", "Membre", { required: true }), opt(3, "raison", "Motif (envoyé au membre)", { max_length: 200 })]),
      sub("note", "Note interne sur un abonné", [opt(6, "membre", "Membre", { required: true }), opt(3, "texte", "Note (vide = effacer)", { max_length: 200 })]),
      sub("fiche", "Fiche complète d'un abonné", [opt(6, "membre", "Membre", { required: true })]),
      sub("abonnes", "Liste des abonnés", [opt(3, "statut", "Filtrer", { choices: [{ name: "Actifs", value: "active" }, { name: "En pause", value: "paused" }, { name: "Expirés", value: "expired" }, { name: "Résiliés", value: "cancelled" }] })]),
      sub("espace", "Crée ou répare l'espace privé d'un membre", [opt(6, "membre", "Membre", { required: true })]),
      sub("espace-fermer", "Supprime l'espace privé d'un membre", [opt(6, "membre", "Membre", { required: true })]),
      sub("demandes", "Demandes des membres en attente"),
      sub("actualiser", "Met à jour tous les panneaux des espaces"),
    ],
  },
  {
    name: "nuit",
    description: "GUARD : mode nuit planifié (mode lent, verrouillage, anti-raid renforcé)",
    usage: "/nuit etat · configurer · activer · desactiver · salon-ajouter · salon-retirer",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("etat", "Réglages et état du mode nuit"),
      sub("configurer", "Plage horaire et mesures de nuit", [
        opt(4, "debut", "Heure de début, Paris (0 à 23)", { min_value: 0, max_value: 23 }),
        opt(4, "fin", "Heure de fin, Paris (0 à 23)", { min_value: 0, max_value: 23 }),
        opt(4, "lent", "Mode lent en secondes (0 = aucun)", { min_value: 0, max_value: 21600 }),
        opt(5, "verrouiller", "Empêcher @everyone d'écrire la nuit"),
        opt(4, "antiraid", "Seuil d'arrivées du mode raid la nuit (3 à 100)", { min_value: 3, max_value: 100 }),
      ]),
      sub("activer", "Programme le mode nuit"),
      sub("desactiver", "Arrête le mode nuit (salons remis comme avant)"),
      sub("salon-ajouter", "Ajoute un salon concerné", [opt(7, "salon", "Salon", { required: true, channel_types: [0, 5] })]),
      sub("salon-retirer", "Retire un salon", [opt(7, "salon", "Salon", { required: true, channel_types: [0, 5] })]),
    ],
  },
  {
    name: "medias",
    description: "GUARD : salons réservés aux médias (texte seul supprimé, fil de commentaires)",
    usage: "/medias ajouter salon [fils] · retirer salon · liste",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageChannels,
    options: [
      sub("ajouter", "Réserve un salon aux médias", [opt(7, "salon", "Salon", { required: true, channel_types: [0] }), opt(5, "fils", "Fil de commentaires sous chaque média (oui par défaut)")]),
      sub("retirer", "Rend un salon normal", [opt(7, "salon", "Salon", { required: true, channel_types: [0] })]),
      sub("liste", "Les salons médias du serveur"),
    ],
  },
  {
    name: "doublecompte",
    description: "GUARD : ce compte ressemble-t-il à un membre banni ? (indice pour le staff)",
    usage: "/doublecompte membre",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Compte à vérifier", { required: true })],
  },
  {
    name: "membredumois",
    description: "Vote pour le membre du mois : rôle pendant 30 jours et prime en PND",
    usage: "/membredumois voter membre · classement · configurer [role] [salon] [prime]",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voter", "Vote (une fois par mois, modifiable) pour un membre", [opt(6, "membre", "Ton choix", { required: true })]),
      sub("classement", "Votes du mois en cours"),
      sub("configurer", "Admins : rôle du gagnant, salon d'annonce, prime", [
        opt(8, "role", "Rôle donné pendant 30 jours"),
        opt(7, "salon", "Salon de l'annonce", { channel_types: [0, 5] }),
        opt(4, "prime", "Prime en PND (0 à 100 000)", { min_value: 0, max_value: 100000 }),
      ]),
    ],
  },
  {
    name: "largage",
    description: "LE FISC : coffre de PND qui tombe dans un salon actif, le premier qui clique gagne",
    usage: "/largage etat · activer · desactiver · configurer [minimum] [maximum]",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("etat", "Réglages actuels"),
      sub("activer", "Active les largages"),
      sub("desactiver", "Coupe les largages"),
      sub("configurer", "Montant tiré entre un minimum et un maximum", [
        opt(4, "minimum", "PND au moins", { min_value: 1, max_value: 10000 }),
        opt(4, "maximum", "PND au plus", { min_value: 1, max_value: 10000 }),
      ]),
    ],
  },
  {
    name: "anciennete",
    description: "SUCK ME : badges d'ancienneté (1 mois, 6 mois, 1 an) et message d'anniversaire d'arrivée",
    usage: "/anciennete etat · activer · desactiver · configurer [role-1-mois] [role-6-mois] [role-1-an] [salon]",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("etat", "Réglages actuels"),
      sub("activer", "Active les badges et les anniversaires"),
      sub("desactiver", "Coupe les badges et les anniversaires"),
      sub("configurer", "Choisis les rôles et le salon des anniversaires", [
        opt(8, "role-1-mois", "Rôle après 1 mois"),
        opt(8, "role-6-mois", "Rôle après 6 mois"),
        opt(8, "role-1-an", "Rôle après 1 an"),
        opt(7, "salon", "Salon des messages d'anniversaire", { channel_types: [0, 5] }),
      ]),
    ],
  },
  {
    name: "decompte",
    description: "SUCK ME : compte à rebours d'un événement, rappel aux inscrits à J-1 et H-1",
    usage: "/decompte demarrer id salon · arreter id",
    category: "Jeux & événements",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("demarrer", "Publie un message qui se met à jour jusqu'au début de l'événement", [
        opt(4, "id", "Identifiant de l'événement (/event liste)", { required: true, min_value: 1 }),
        opt(7, "salon", "Salon du compte à rebours", { required: true, channel_types: [0, 5] }),
      ]),
      sub("arreter", "Arrête le compte à rebours d'un événement", [
        opt(4, "id", "Identifiant de l'événement", { required: true, min_value: 1 }),
      ]),
    ],
  },
  {
    name: "attente",
    description: "FDPDLAVOC : salle d'attente du support vocal, le staff est alerté quand un membre attend",
    usage: "/attente etat · configurer salle alerte [role] · desactiver",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("etat", "Réglages actuels"),
      sub("configurer", "Choisis la salle d'attente, le salon d'alerte et le rôle à prévenir", [
        opt(7, "salle", "Salon vocal d'attente", { required: true, channel_types: [2, 13] }),
        opt(7, "alerte", "Salon textuel des alertes staff", { required: true, channel_types: [0, 5] }),
        opt(8, "role", "Rôle support à mentionner"),
      ]),
      sub("desactiver", "Coupe les alertes"),
    ],
  },
  {
    name: "rapportstaff",
    description: "SUCK ME : rapport du staff chaque lundi et alerte après 14 jours d'inactivité",
    usage: "/rapportstaff etat · configurer salon · desactiver",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("etat", "Réglages actuels"),
      sub("configurer", "Choisis le salon (réservé au staff) du rapport et des alertes", [
        opt(7, "salon", "Salon du rapport", { required: true, channel_types: [0, 5] }),
      ]),
      sub("desactiver", "Coupe le rapport et les alertes"),
    ],
  },
  {
    name: "charte",
    description: "SUCK ME : charte du staff à lire et accepter, suivi de ceux qui ne l'ont pas fait",
    usage: "/charte voir · definir · suivi",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Lis la charte et accepte-la (staff)"),
      sub("definir", "Admins : écris ou modifie la charte (chacun devra ré-accepter)"),
      sub("suivi", "Admins : qui n'a pas encore accepté la version en cours"),
    ],
  },
  {
    name: "courante",
    description: "SUCK ME : main courante du staff, journal de bord partagé entre les gardes",
    usage: "/courante ajouter texte · voir [jours] · retirer id",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("ajouter", "Note ce qui s'est passé (400 caractères, pas de données sensibles)", [opt(3, "texte", "Ce qui s'est passé", { required: true, max_length: 400 })]),
      sub("voir", "Relis les dernières entrées", [opt(4, "jours", "Nombre de jours (1 à 30, 2 par défaut)", { min_value: 1, max_value: 30 })]),
      sub("retirer", "Retire une entrée (la tienne, ou n'importe laquelle pour un admin)", [opt(4, "id", "Numéro de l'entrée", { required: true, min_value: 1 })]),
    ],
  },
  {
    name: "compteurs",
    description: "SUCK ME : salons compteurs (membres, en vocal, boosts) mis à jour toutes les 10 min",
    usage: "/compteurs installer · retirer · actualiser",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    defaultMemberPermissions: manageServer,
    options: [
      sub("installer", "Crée la catégorie Statistiques et ses salons compteurs"),
      sub("retirer", "Supprime les salons compteurs"),
      sub("actualiser", "Met les compteurs à jour tout de suite"),
    ],
  },
  {
    name: "invitations",
    description: "SUCK ME : tes invitations récompensées (PND si l'invité reste 7 jours) et le classement",
    usage: "/invitations moi [membre] · classement",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("moi", "Tes invitations (ou celles d'un membre)", [opt(6, "membre", "Membre")]),
      sub("classement", "Les meilleurs inviteurs du serveur"),
    ],
  },
  {
    name: "braquage",
    description: "LE FISC : monte une équipe (3 à 5) pour braquer la caisse du serveur",
    usage: "/braquage",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "prime",
    description: "LE FISC : prime sur un membre, gagnée en le battant en duel ou en le volant",
    usage: "/prime poser membre montant · voir [membre] · liste",
    category: "Économie",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("poser", "Met une prime sur la tête d'un membre (argent bloqué tout de suite)", [
        opt(6, "membre", "La cible", { required: true }),
        opt(4, "montant", "Montant (100 à 50 000 PND)", { required: true, min_value: 100, max_value: 50000 }),
      ]),
      sub("voir", "La prime sur un membre", [opt(6, "membre", "Membre")]),
      sub("liste", "Les avis de recherche du serveur"),
    ],
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
    description: "SUCK ME : échelle, promotions, absences, disponibilités, astreintes, planning, passation",
    usage: "/staff centre · liste · echelle · promouvoir · retrograder · absence · retour · dispo · astreinte · disponibles · planning · passation · intervention · mission · reunion · formation",
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
      sub("dispo", "Tes créneaux habituels (heure de Paris), ex. lun-ven 18-23, sam 14-2", [opt(3, "creneaux", "Ex. « lun-ven 18-23, sam 14-2 » ; « aucun » pour effacer ; vide pour voir", { max_length: 200 })]),
      sub("astreinte", "Prendre, terminer ou voir les astreintes (aucun rôle donné)", [
        opt(3, "action", "Action", { choices: [{ name: "Prendre", value: "prendre" }, { name: "Terminer", value: "terminer" }, { name: "Voir", value: "voir" }] }),
        opt(3, "duree", "Durée si tu prends : 4h, 12h, 1j (12 h par défaut, 7 j maximum)", { max_length: 20 }),
      ]),
      sub("disponibles", "Staff joignable maintenant : astreinte, créneaux, absences"),
      sub("centre", "Centre de commandement : staff joignable, dossiers, tickets, alertes, bots"),
      sub("planning", "Couverture de la semaine par tranche horaire, et les trous"),
      sub("passation", "Laisse une note de relève à l'équipe suivante, ou lis les dernières", [opt(3, "note", "Ce que l'équipe suivante doit savoir (vide pour lire)", { max_length: 1500 })]),
      {
        type: 2, name: "intervention", description: "Dossiers d'intervention du staff (incident, enquête, plainte)",
        options: [
          sub("ouvrir", "Ouvre un dossier d'intervention", [
            opt(3, "titre", "De quoi s'agit-il ?", { required: true, max_length: 120 }),
            opt(6, "membre", "Membre concerné"),
            opt(3, "priorite", "Priorité (haute = clôture validée par un autre responsable)", { choices: [{ name: "Basse", value: "basse" }, { name: "Normale", value: "normale" }, { name: "Haute", value: "haute" }] }),
          ]),
          sub("liste", "Dossiers en cours, à valider ou clos", [opt(3, "statut", "Lesquels", { choices: [{ name: "En cours", value: "actifs" }, { name: "À valider", value: "a_valider" }, { name: "Clos", value: "clos" }, { name: "Tous", value: "tous" }] })]),
          sub("voir", "Affiche un dossier et son historique", [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 })]),
          sub("assigner", "Confie le dossier à un membre du staff", [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 }), opt(6, "membre", "Membre du staff", { required: true })]),
          sub("preuve", "Ajoute une preuve (lien https, message du serveur) ou une référence (sanction:12)", [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 }), opt(3, "lien", "Lien ou référence", { required: true, max_length: 400 })]),
          sub("note", "Ajoute une note d'enquête", [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 }), opt(3, "texte", "Note", { required: true, max_length: 500 })]),
          sub("cloturer", "Clôt le dossier avec sa conclusion", [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 }), opt(3, "conclusion", "Ce qui a été fait", { required: true, max_length: 500 })]),
          sub("valider", "Valide la clôture d'un dossier prioritaire (autre responsable)", [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 })]),
        ],
      },
      {
        type: 2, name: "mission", description: "Missions et objectifs du staff",
        options: [
          sub("creer", "SYS+ : crée une mission (un membre du staff ou tout le staff)", [
            opt(3, "titre", "La mission", { required: true, max_length: 150 }),
            opt(6, "membre", "Membre du staff (vide = tout le staff)"),
            opt(3, "echeance", "Échéance (heure de Paris) : 28/11 21h, demain 20h", { max_length: 30 }),
          ]),
          sub("liste", "Missions en cours"),
          sub("terminer", "Termine une mission avec son bilan", [opt(4, "numero", "Numéro de la mission", { required: true, min_value: 1 }), opt(3, "bilan", "Ce qui a été fait", { required: true, max_length: 500 })]),
          sub("annuler", "SYS+ : annule une mission", [opt(4, "numero", "Numéro de la mission", { required: true, min_value: 1 })]),
        ],
      },
      {
        type: 2, name: "reunion", description: "Réunions du staff et comptes rendus",
        options: [
          sub("planifier", "SYS+ : planifie une réunion (rappel 30 min avant dans ce salon)", [
            opt(3, "sujet", "Sujet", { required: true, max_length: 150 }),
            opt(3, "date", "Date et heure de Paris : 28/11 21h, demain 20h30", { required: true, max_length: 30 }),
          ]),
          sub("liste", "Réunions à venir et derniers comptes rendus"),
          sub("compte-rendu", "Ajoute le compte rendu d'une réunion", [opt(4, "numero", "Numéro de la réunion", { required: true, min_value: 1 }), opt(3, "texte", "Compte rendu", { required: true, max_length: 1500 })]),
          sub("annuler", "Annule une réunion", [opt(4, "numero", "Numéro de la réunion", { required: true, min_value: 1 })]),
        ],
      },
      {
        type: 2, name: "formation", description: "Formation du staff : exercices, validation des parcours Academy",
        options: [
          sub("exercice", "Lance un cas pratique (raid, conflit, signalement)", [
            opt(3, "type", "Exercice", { choices: [{ name: "Raid", value: "raid" }, { name: "Conflit entre membres", value: "conflit" }, { name: "Signalement sensible", value: "signalement" }] }),
            opt(6, "membre", "Stagiaire (SYS+ ; vide = toi)"),
          ]),
          sub("reponse", "Réponds à un exercice", [opt(3, "id", "Identifiant de l'exercice", { required: true, max_length: 12 }), opt(3, "reponses", "Tes lettres, ex. B,A,C,B", { required: true, max_length: 30 })]),
          sub("valider", "SYS+ : certifie un parcours Academy terminé (aucun rôle donné)", [opt(6, "membre", "Membre", { required: true }), opt(3, "parcours", "Identifiant du parcours (/academy liste)", { required: true, max_length: 40 })]),
          sub("certifications", "Parcours certifiés et exercices d'un membre", [opt(6, "membre", "Membre (vide = toi)")]),
        ],
      },
    ],
  },
  {
    name: "authority",
    description: "Demandes d'autorisation exceptionnelle, décidées par l'OWNER",
    usage: "/authority demander · mes-demandes · statut · historique · panneau · decider",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("demander", "Demande une autorisation exceptionnelle (décision de l'OWNER)", [
        opt(3, "type", "Autorisation", { required: true, choices: [
          { name: "Salon vocal supplémentaire", value: "voice.room.extra" },
          { name: "Quota de modération doublé (staff)", value: "moderation.quota.extra" },
          { name: "Quota économique supplémentaire", value: "economy.quota.extra" },
          { name: "Accès à un module en test", value: "module.beta.access" },
          { name: "Créer des missions du staff", value: "staff.mission.create" },
          { name: "Planifier des réunions du staff", value: "staff.meeting.plan" },
        ] }),
        opt(3, "justification", "Pourquoi ? (obligatoire)", { required: true, max_length: 500 }),
        opt(3, "duree", "Durée : 12h, 3j (1 h à 30 j, 24 h par défaut)", { max_length: 20 }),
        opt(6, "beneficiaire", "Pour qui (vide = toi)"),
      ]),
      sub("mes-demandes", "Tes demandes et celles qui te concernent"),
      sub("statut", "État d'une demande", [opt(4, "numero", "Numéro", { required: true, min_value: 1 })]),
      sub("historique", "Historique d'une demande", [opt(4, "numero", "Numéro", { required: true, min_value: 1 })]),
      sub("panneau", "OWNER : demandes en attente et dérogations actives"),
      sub("decider", "OWNER : suspendre, réactiver, révoquer ou prolonger", [
        opt(4, "numero", "Numéro", { required: true, min_value: 1 }),
        opt(3, "action", "Décision", { required: true, choices: [{ name: "Suspendre", value: "suspendre" }, { name: "Réactiver", value: "reactiver" }, { name: "Révoquer", value: "revoquer" }, { name: "Prolonger", value: "prolonger" }] }),
        opt(3, "duree", "Prolongation : 12h, 3j", { max_length: 20 }),
      ]),
    ],
  },
  {
    name: "maj",
    description: "OWNER : met à jour les 5 bots depuis GitHub, sans ordinateur",
    usage: "/maj lancer [version] · /maj etat",
    category: "SYS+",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("lancer", "Installe la dernière version publiée, ou une version précise (10 à 30 min)", [opt(3, "version", "Version précise pour revenir en arrière, ex. v1.2.0", { max_length: 20 })]),
      sub("etat", "Avancement et journal de la dernière mise à jour"),
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
    name: "blindtest",
    description: "FDPDLAVOC : blind test musical dans ton salon vocal",
    usage: "/blindtest lancer [manches] [playlist] · stop · classement",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("lancer", "Lance une partie dans ton vocal (réponses écrites dans ce salon)", [
        opt(4, "manches", "Nombre de manches (3 à 15, 8 par défaut)", { min_value: 3, max_value: 15 }),
        opt(3, "playlist", "Une de tes playlists musique (sinon la liste par défaut)", { max_length: 40 }),
      ]),
      sub("stop", "Arrête la partie en cours (organisateur ou staff)"),
      sub("classement", "Classement du blind test sur le serveur"),
    ],
  },
  {
    name: "lecture",
    description: "FDPDLAVOC : lit à voix haute le chat de ton vocal (pour qui ne peut pas parler)",
    usage: "/lecture activer · desactiver",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("activer", "Le bot rejoint ton vocal et lit les messages écrits dans son chat"),
      sub("desactiver", "Arrête la lecture vocale (celui qui l'a lancée ou le staff)"),
    ],
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
  {
    name: "sanction",
    description: "Historique complet des sanctions d'un membre (tous bots confondus)",
    usage: "/sanction membre [page]",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à consulter", { required: true }),
      opt(4, "page", "Page de l'historique (10 sanctions par page)", { min_value: 1, max_value: 100 }),
    ],
  },
  {
    name: "sanction-type",
    description: "Admins : gère les sanctions prédéfinies de /tempmute et leurs durées",
    usage: "/sanction-type liste · ajouter nom duree · modifier sanction [nom] [duree] · supprimer sanction",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("liste", "Affiche les sanctions prédéfinies et leurs durées"),
      sub("ajouter", "Ajoute une sanction prédéfinie", [
        opt(3, "nom", "Nom de la sanction (ex. Spam)", { required: true, max_length: 80 }),
        opt(3, "duree", "Durée : 10m, 1h, 1h30, 2j…", { required: true, max_length: 20 }),
      ]),
      sub("modifier", "Modifie le nom ou la durée d'une sanction", [
        opt(3, "sanction", "Sanction à modifier", { required: true, autocomplete: true, max_length: 20 }),
        opt(3, "nom", "Nouveau nom", { max_length: 80 }),
        opt(3, "duree", "Nouvelle durée : 10m, 1h, 2j…", { max_length: 20 }),
      ]),
      sub("supprimer", "Supprime une sanction prédéfinie", [
        opt(3, "sanction", "Sanction à supprimer", { required: true, autocomplete: true, max_length: 20 }),
      ]),
    ],
  },
  {
    name: "quota",
    description: "Owner : quotas de modération partagés entre les 5 bots",
    usage: "/quota moi · voir · definir · reinitialiser · palier · paliers · exemption … · bot … · journal",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("moi", "Ce qu'il te reste pour chaque commande, et quand la suivante se libère"),
      sub("voir", "Affiche les quotas en vigueur (et ton palier)", [
        opt(3, "commande", "Limiter à une commande", { choices: QUOTA_COMMAND_CHOICES }),
      ]),
      sub("definir", "Modifie un quota à chaud (sans redéploiement)", [
        opt(3, "commande", "Commande de modération", { required: true, choices: QUOTA_COMMAND_CHOICES }),
        opt(4, "palier", "Palier de rôle", { required: true, choices: MODERATION_TIER_CHOICES }),
        opt(3, "valeur", "Nombre d'utilisations (0 = interdit, « illimite » = sans limite)", { required: true, max_length: 10 }),
        opt(3, "fenetre", "Fenêtre de temps : 30m, 1h, 1j…", { required: true, max_length: 20 }),
      ]),
      sub("reinitialiser", "Revient à la valeur par défaut pour ce serveur", [
        opt(3, "commande", "Commande de modération", { required: true, choices: QUOTA_COMMAND_CHOICES }),
        opt(4, "palier", "Palier de rôle", { required: true, choices: MODERATION_TIER_CHOICES }),
      ]),
      sub("palier", "Associe un rôle à un palier (0 %, 1 %, 5 %, 10 %, 50 %, 70 %, 80 %, 100 %)", [
        opt(8, "role", "Rôle Discord", { required: true }),
        opt(4, "palier", "Palier (−1 = retirer l'association)", { required: true, choices: [...ALL_TIER_CHOICES, { name: "Retirer l'association", value: -1 }] }),
      ]),
      sub("paliers", "Affiche les rôles associés à chaque palier (staff)"),
      { type: 2, name: "exemption", description: "Exemptions de quota par utilisateur", options: [
        sub("ajouter", "Exempte un utilisateur de tous les quotas", [
          opt(3, "utilisateur", "Mention ou ID", { required: true, max_length: 40 }),
          opt(3, "raison", "Raison", { max_length: 200 }),
        ]),
        sub("retirer", "Retire une exemption", [opt(3, "utilisateur", "Mention ou ID", { required: true, max_length: 40 })]),
        sub("liste", "Liste les utilisateurs exemptés"),
      ] },
      { type: 2, name: "bot", description: "Whitelist des bots qui outrepassent les quotas", options: [
        sub("ajouter", "Ajoute un bot à la whitelist", [opt(3, "bot", "Mention ou ID du bot", { required: true, max_length: 40 })]),
        sub("retirer", "Retire un bot de la whitelist", [opt(3, "bot", "Mention ou ID du bot", { required: true, max_length: 40 })]),
        sub("liste", "Liste les bots whitelistés"),
      ] },
      sub("journal", "Dernières modifications de configuration (qui, quoi, avant, après)"),
    ],
  },
  {
    name: "embed",
    description: "Admins : crée, édite et publie des embeds",
    usage: "/embed creer · modifier · champ · champ-retirer · apercu · publier · importer · liste · supprimer",
    category: "Embeds & règlement",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("creer", "Crée un embed (formulaire : titre, description, couleur, image, footer)", [
        opt(3, "nom", "Identifiant court (lettres, chiffres, - et _)", { required: true, max_length: 32 }),
      ]),
      sub("modifier", "Modifie un embed (formulaire prérempli)", [
        opt(3, "nom", "Embed à modifier", { required: true, autocomplete: true, max_length: 32 }),
      ]),
      sub("champ", "Ajoute un champ à un embed", [
        opt(3, "nom", "Embed", { required: true, autocomplete: true, max_length: 32 }),
        opt(3, "titre", "Titre du champ", { required: true, max_length: 256 }),
        opt(3, "valeur", "Contenu du champ", { required: true, max_length: 1024 }),
        opt(5, "en_ligne", "Afficher sur la même ligne que le champ voisin"),
      ]),
      sub("champ-retirer", "Retire un champ (par numéro)", [
        opt(3, "nom", "Embed", { required: true, autocomplete: true, max_length: 32 }),
        opt(4, "numero", "Numéro du champ (1 = premier)", { required: true, min_value: 1, max_value: 25 }),
      ]),
      sub("image", "Change l'image, la miniature ou l'auteur", [
        opt(3, "nom", "Embed", { required: true, autocomplete: true, max_length: 32 }),
        opt(3, "image", "URL HTTPS de la grande image (vide = retirer)", { max_length: 500 }),
        opt(3, "miniature", "URL HTTPS de la miniature (vide = retirer)", { max_length: 500 }),
      ]),
      sub("apercu", "Affiche l'embed (visible par toi seul)", [
        opt(3, "nom", "Embed", { required: true, autocomplete: true, max_length: 32 }),
      ]),
      sub("publier", "Publie l'embed dans un salon (ou met à jour le message déjà publié)", [
        opt(3, "nom", "Embed", { required: true, autocomplete: true, max_length: 32 }),
        opt(7, "salon", "Salon cible (par défaut : salon de la dernière publication)", { channel_types: [0, 5] }),
      ]),
      sub("importer", "Reprend un embed déjà publié par le bot pour pouvoir l'éditer", [
        opt(3, "lien", "Lien du message", { required: true, max_length: 200 }),
        opt(3, "nom", "Identifiant à lui donner", { required: true, max_length: 32 }),
      ]),
      sub("liste", "Liste les embeds enregistrés"),
      sub("supprimer", "Supprime un embed enregistré (le message publié reste)", [
        opt(3, "nom", "Embed", { required: true, autocomplete: true, max_length: 32 }),
      ]),
    ],
  },
  {
    name: "reglement",
    description: "Admins : règlement écrit ou généré par l'IA, publié en embed",
    usage: "/reglement generer [consignes] [nombre] · ecrire · apercu · publier salon",
    category: "Embeds & règlement",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("generer", "Génère un brouillon de règlement (aperçu à valider)", [
        opt(3, "consignes", "Ton, thèmes à couvrir, points importants", { max_length: 1000 }),
        opt(4, "nombre", "Nombre de règles (5 à 20)", { min_value: 5, max_value: 20 }),
      ]),
      sub("ecrire", "Écris ou corrige le règlement toi-même (sans IA), une règle par ligne"),
      sub("apercu", "Réaffiche le dernier brouillon et ses boutons de validation"),
      sub("publier", "Publie le dernier règlement validé", [
        opt(7, "salon", "Salon du règlement", { required: true, channel_types: [0, 5] }),
      ]),
    ],
  },
  {
    name: "snipe",
    description: "Staff : dernier message supprimé ou modifié d'un salon (10 dernières minutes)",
    usage: "/snipe [type] [salon]",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(3, "type", "Supprimé (par défaut) ou modifié", { choices: [{ name: "Supprimé", value: "supprime" }, { name: "Modifié", value: "modifie" }] }),
      opt(7, "salon", "Salon (par défaut : celui-ci)", { channel_types: [0, 2, 5, 11, 12] }),
    ],
  },
  {
    name: "screening",
    description: "Admins : écran d'adhésion alimenté par le règlement validé",
    usage: "/screening configurer salon role · synchroniser · etat",
    category: "Embeds & règlement",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("configurer", "Publie le règlement avec un bouton « J'accepte » qui donne l'accès", [
        opt(7, "salon", "Salon d'arrivée", { required: true, channel_types: [0] }),
        opt(8, "role", "Rôle donné après acceptation", { required: true }),
      ]),
      sub("synchroniser", "Copie le règlement validé dans le Membership Screening natif de Discord"),
      sub("etat", "Affiche la configuration de l'écran d'adhésion"),
    ],
  },
  {
    name: "logs",
    description: "Staff : journaux typés (recherche, chronologie) ; OWNER : configuration du hub",
    usage: "/logs statut · rechercher · chronologie · hub · source-ajouter · source-activer · source-retirer · alertes · conservation · resume",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("statut", "Hub, serveurs sources, logs en attente et logs perdus"),
      sub("rechercher", "Cherche dans la copie en base des journaux", [
        opt(6, "membre", "Membre concerné (acteur ou cible)"),
        opt(3, "action", "Code d'action (ban, warn, blr_set…)", { max_length: 40 }),
        opt(3, "periode", "Période : 1h, 7j, 30j…", { max_length: 10 }),
      ]),
      sub("chronologie", "Chronologie d'un membre", [opt(6, "membre", "Membre", { required: true })]),
      sub("hub", "OWNER : serveur qui reçoit les journaux", [opt(3, "serveur", "ID du serveur hub", { required: true, max_length: 20 })]),
      sub("source-ajouter", "OWNER : ajoute un serveur source (un jeu de salons par source)", [
        opt(3, "serveur", "ID du serveur source", { required: true, max_length: 20 }),
        opt(3, "nom", "Nom court (préfixe des salons, ex. mz)", { required: true, max_length: 12 }),
        opt(3, "libelle", "Libellé affiché", { max_length: 60 }),
      ]),
      sub("source-activer", "OWNER : active ou coupe une source", [
        opt(3, "serveur", "ID du serveur source", { required: true, max_length: 20 }),
        opt(5, "actif", "Activer ?", { required: true }),
      ]),
      sub("source-retirer", "OWNER : retire un serveur source", [opt(3, "serveur", "ID du serveur source", { required: true, max_length: 20 })]),
      sub("alertes", "OWNER : rôle du hub prévenu pour les alertes graves (vide = aucun)", [opt(3, "role", "ID du rôle dans le hub", { max_length: 20 })]),
      sub("conservation", "OWNER : durée de conservation de la copie en base", [opt(4, "jours", "7 à 730 jours", { required: true, min_value: 7, max_value: 730 })]),
      sub("resume", "OWNER : résumé automatique des journaux", [
        opt(3, "frequence", "Fréquence", { required: true, choices: [{ name: "Quotidien", value: "daily" }, { name: "Hebdomadaire", value: "weekly" }, { name: "Désactivé", value: "off" }] }),
      ]),
    ],
  },
  {
    name: "smash",
    description: "Smash or pass entre membres inscrits (majeurs, votes anonymes)",
    usage: "/smash inscrire majeur · jouer · score · desinscrire · retirer membre · retablir membre",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("inscrire", "Participer (réservé aux personnes majeures)", [opt(5, "majeur", "Je confirme avoir 18 ans ou plus", { required: true })]),
      sub("jouer", "Noter des profils (votes anonymes)"),
      sub("score", "Ton score (compteurs seulement)"),
      sub("desinscrire", "Quitter le jeu : profil et votes effacés"),
      sub("retirer", "Staff : retirer un profil", [opt(6, "membre", "Membre", { required: true })]),
      sub("retablir", "Staff : rétablir un profil suspendu après signalements", [opt(6, "membre", "Membre", { required: true })]),
    ],
  },
  {
    name: "famille",
    description: "Relations entre membres : mariage, adoption, arbre familial",
    usage: "/famille mariage membre · divorce · adopter membre · emanciper · renier membre · arbre [membre]",
    category: "Communauté",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("mariage", "Demander un membre en mariage (il doit accepter)", [opt(6, "membre", "Membre à épouser", { required: true })]),
      sub("divorce", "Mettre fin à ton mariage"),
      sub("adopter", "Proposer d'adopter un membre (il doit accepter)", [opt(6, "membre", "Membre à adopter", { required: true })]),
      sub("emanciper", "Quitter ta famille (tes parents)"),
      sub("renier", "Retirer un de tes enfants", [opt(6, "membre", "Ton enfant", { required: true })]),
      sub("arbre", "Afficher un arbre familial", [opt(6, "membre", "Membre (toi par défaut)")]),
    ],
  },
  {
    name: "stabilite",
    description: "OWNER/admins : couper une commande ou mettre un bot en maintenance ; OWNER : maintenance globale",
    usage: "/stabilite commande-off commande [raison] · commande-on commande · maintenance-on bot [raison] · maintenance-off bot · maintenance-global-on|off [salon] · etat",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("commande-off", "Coupe une commande sur les 6 bots sans redémarrer", [opt(3, "commande", "Nom de la commande", { required: true, max_length: 32 }), opt(3, "raison", "Raison affichée", { max_length: 200 })]),
      sub("commande-on", "Rétablit une commande", [opt(3, "commande", "Nom de la commande", { required: true, max_length: 32 })]),
      sub("maintenance-on", "Met un bot en maintenance (message clair aux membres)", [opt(3, "bot", "Bot", { required: true, choices: [{ name: "Bot principal", value: "fwu" }, { name: "GUARD", value: "guard" }, { name: "FDPDLAVOC", value: "fdpdlavoc" }, { name: "SUCK ME", value: "suckme" }, { name: "LE FISC", value: "fisc" }, { name: "Invest +", value: "investplus" }] }), opt(3, "raison", "Message", { max_length: 200 })]),
      sub("maintenance-off", "Termine la maintenance d'un bot", [opt(3, "bot", "Bot", { required: true, choices: [{ name: "Bot principal", value: "fwu" }, { name: "GUARD", value: "guard" }, { name: "FDPDLAVOC", value: "fdpdlavoc" }, { name: "SUCK ME", value: "suckme" }, { name: "LE FISC", value: "fisc" }, { name: "Invest +", value: "investplus" }] })]),
      sub("maintenance-global-on", "OWNER : suspend les commandes sur tous les bots", [opt(3, "raison", "Message affiché aux membres", { max_length: 200 }), opt(7, "salon", "Salon où publier l'annonce de maintenance")]),
      sub("maintenance-global-off", "OWNER : rétablit les commandes sur tous les bots", [opt(7, "salon", "Salon où publier l'annonce de fin de maintenance")]),
      sub("etat", "Commandes coupées et maintenance"),
    ],
  },
  {
    name: "presence",
    description: "OWNER/admins : statut d'un bot sans modifier de fichier, ou sa description",
    usage: "/presence definir bot texte [type] [statut] [duree] · retirer bot · description bot texte",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("definir", "Impose un statut (prioritaire sur la rotation)", [
        opt(3, "bot", "Bot", { required: true, choices: [{ name: "Bot principal", value: "fwu" }, { name: "GUARD", value: "guard" }, { name: "FDPDLAVOC", value: "fdpdlavoc" }, { name: "SUCK ME", value: "suckme" }, { name: "LE FISC", value: "fisc" }, { name: "Invest +", value: "investplus" }] }),
        opt(3, "texte", "Texte affiché (120 caractères)", { required: true, max_length: 120 }),
        opt(3, "type", "Type d'activité", { choices: [{ name: "Statut personnalisé", value: "custom" }, { name: "Joue à", value: "playing" }, { name: "Regarde", value: "watching" }, { name: "Écoute", value: "listening" }, { name: "Participe à", value: "competing" }] }),
        opt(3, "statut", "Pastille", { choices: [{ name: "En ligne", value: "online" }, { name: "Absent", value: "idle" }, { name: "Ne pas déranger", value: "dnd" }] }),
        opt(3, "duree", "Durée : 30m, 2h, 1j (vide = jusqu'au retrait)", { max_length: 10 }),
      ]),
      sub("retirer", "Rétablit le statut automatique", [
        opt(3, "bot", "Bot", { required: true, choices: [{ name: "Bot principal", value: "fwu" }, { name: "GUARD", value: "guard" }, { name: "FDPDLAVOC", value: "fdpdlavoc" }, { name: "SUCK ME", value: "suckme" }, { name: "LE FISC", value: "fisc" }, { name: "Invest +", value: "investplus" }] }),
      ]),
      sub("description", "Texte « À propos » du bot", [
        opt(3, "bot", "Bot", { required: true, choices: [{ name: "Bot principal", value: "fwu" }, { name: "GUARD", value: "guard" }, { name: "FDPDLAVOC", value: "fdpdlavoc" }, { name: "SUCK ME", value: "suckme" }, { name: "LE FISC", value: "fisc" }, { name: "Invest +", value: "investplus" }] }),
        opt(3, "texte", "Description (400 caractères)", { required: true, max_length: 400 }),
      ]),
    ],
  },
  {
    name: "accessall",
    description: "Ouvre ton vocal à tout le monde (photo des permissions) ; annuler = retour",
    usage: "/accessall [annuler]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(5, "annuler", "Revenir aux permissions d'avant")],
  },
  {
    name: "mvall",
    description: "Déplace tous les membres d'un vocal vers un autre (aperçu puis confirmation)",
    usage: "/mvall source cible",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(7, "source", "Vocal source", { required: true, channel_types: [2] }), opt(7, "cible", "Vocal cible", { required: true, channel_types: [2] })],
  },
  {
    name: "mvrole",
    description: "Déplace les membres d'un rôle connectés vers un vocal",
    usage: "/mvrole role cible",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(8, "role", "Rôle", { required: true }), opt(7, "cible", "Vocal cible", { required: true, channel_types: [2] })],
  },
  {
    name: "pull",
    description: "Amène un membre dans ton salon vocal",
    usage: "/pull membre",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre", { required: true })],
  },
  {
    name: "swap",
    description: "Échange les salons vocaux de deux membres",
    usage: "/swap membre_a membre_b",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre_a", "Premier membre", { required: true }), opt(6, "membre_b", "Second membre", { required: true })],
  },
  {
    name: "muteall",
    description: "Rend muets les membres d'un vocal (aperçu puis confirmation)",
    usage: "/muteall [salon]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(7, "salon", "Vocal (par défaut : le tien)", { channel_types: [2] })],
  },
  {
    name: "unmuteall",
    description: "Rend la parole aux membres d'un vocal",
    usage: "/unmuteall [salon]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(7, "salon", "Vocal (par défaut : le tien)", { channel_types: [2] })],
  },
  {
    name: "vclear",
    description: "Déconnecte les membres d'un vocal (aperçu puis confirmation)",
    usage: "/vclear [salon]",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(7, "salon", "Vocal (par défaut : le tien)", { channel_types: [2] })],
  },
  {
    name: "undo",
    description: "Annule la dernière action vocale de masse (30 min)",
    usage: "/undo",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "guide",
    description: "Guide des permissions : rangs, paliers, quotas, sanctions",
    usage: "/guide voir · configurer public [staff] [role_staff] · publier",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("voir", "Affiche le guide avec un menu de sections"),
      sub("configurer", "Admins : salons du guide (public, et staff réservé à un rôle)", [
        opt(7, "public", "Salon public du guide", { required: true, channel_types: [0] }),
        opt(7, "staff", "Salon du guide staff", { channel_types: [0] }),
        opt(8, "role_staff", "Rôle qui voit le guide staff"),
      ]),
      sub("publier", "Admins : republie le guide maintenant"),
    ],
  },
  {
    name: "pourquoi",
    description: "Explique pourquoi une commande t'est refusée ou permise",
    usage: "/pourquoi commande",
    category: "Général",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "commande", "Commande (ex. ban, rank, blr poser)", { required: true, max_length: 60 })],
  },
  {
    name: "piege",
    description: "Admins : salons appâts — qui y écrit (hors staff) passe en BLR",
    usage: "/piege configurer salon · retirer salon · liste",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("configurer", "Ajoute un salon appât", [opt(7, "salon", "Salon appât", { required: true, channel_types: [0] })]),
      sub("retirer", "Retire un salon appât", [opt(7, "salon", "Salon appât", { required: true, channel_types: [0] })]),
      sub("liste", "Salons appâts actifs"),
    ],
  },
  {
    name: "raid",
    description: "Admins : mode raid (invitations fermées, comptes récents en quarantaine)",
    usage: "/raid etat · on · off · purge · seuils",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("etat", "État et seuils du mode raid"),
      sub("on", "Active le mode raid à la main", [opt(3, "raison", "Raison", { max_length: 200 })]),
      sub("off", "Coupe le mode raid", [opt(3, "raison", "Raison", { max_length: 200 })]),
      sub("purge", "Quarantaine ou expulsion d'un coup des comptes récents arrivés pendant un raid", [
        opt(4, "minutes", "Arrivés dans les X dernières minutes (1 à 60, 10 par défaut)", { min_value: 1, max_value: 60 }),
        opt(4, "anciennete_jours", "Comptes créés il y a moins de X jours (0 à 30, 7 par défaut)", { min_value: 0, max_value: 30 }),
        opt(3, "action", "Quarantaine (défaut) ou expulsion", { choices: [{ name: "Quarantaine", value: "quarantaine" }, { name: "Expulsion", value: "expulsion" }] }),
        opt(5, "confirmer", "Vrai pour exécuter (sinon simple aperçu)"),
      ]),
      sub("seuils", "Seuils de détection automatique", [
        opt(4, "arrivees", "Arrivées déclenchant le mode raid", { required: true, min_value: 3, max_value: 100 }),
        opt(4, "secondes", "Fenêtre en secondes", { required: true, min_value: 5, max_value: 600 }),
        opt(4, "calme", "Minutes de calme avant la sortie automatique", { required: true, min_value: 1, max_value: 240 }),
      ]),
    ],
  },
  {
    name: "scan",
    description: "Admins : audit de sécurité du serveur avec un score",
    usage: "/scan",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "panic",
    description: "Admins : verrouillage d'urgence (salons fermés + mode raid)",
    usage: "/panic [raison]",
    category: "Administration & sécurité",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "raison", "Raison", { max_length: 200 })],
  },
  {
    name: "blr",
    description: "OWNER, paliers 0 % et 1 % : BLR, plus aucun rôle au-dessus du rôle membre",
    usage: "/blr poser membre [raison] [duree] · lever membre [restaurer] · liste · configurer role membre",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("poser", "Retire tous les rôles (sauf membre) et pose le BLR", [
        opt(6, "membre", "Membre visé", { required: true }),
        opt(3, "raison", "Raison (visible dans les journaux du staff seulement)", { max_length: 300 }),
        opt(3, "duree", "Durée : 30m, 12h, 7j ou « définitif »", { max_length: 20 }),
      ]),
      sub("lever", "Lève le BLR", [
        opt(6, "membre", "Membre visé", { required: true }),
        opt(5, "restaurer", "Rendre les anciens rôles qui passent la garde ?"),
      ]),
      sub("liste", "Membres BLR (staff)"),
      sub("configurer", "OWNER : rôle BLR et rôle membre", [
        opt(8, "role", "Rôle BLR (sans permission)", { required: true }),
        opt(8, "membre", "Rôle membre (le seul gardé)", { required: true }),
      ]),
    ],
  },
  {
    name: "dossier",
    description: "Staff : affiche un dossier de sanction ou d'action sensible",
    usage: "/dossier numero",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "numero", "Numéro du dossier", { required: true, min_value: 1 })],
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
    ...(o.autocomplete ? { autocomplete: true } : {}),
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
