// Shared, client-safe definitions of the bot's slash commands (Her? V4).
// No secrets here: imported by the panel UI, the interactions server module and
// the standalone Oracle bot. Keeping one list guarantees that the dashboard and
// the bot always register and document the exact same command surface.

export type SlashOptionChoice = { name: string; value: string | number };

export type SlashOption = {
  type: number; // 1 = SUB_COMMAND, 3 = STRING, 4 = INTEGER, 6 = USER, 7 = CHANNEL, 8 = ROLE
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

const manageServer = "32"; // MANAGE_GUILD
const manageMessages = "8192"; // MANAGE_MESSAGES
const manageNicknames = "268435456"; // MANAGE_NICKNAMES
const moderateMembers = "1099511627776"; // MODERATE_MEMBERS
const kickMembers = "2"; // KICK_MEMBERS
const banMembers = "4"; // BAN_MEMBERS
const manageChannels = "16"; // MANAGE_CHANNELS

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // ── Général ────────────────────────────────────────────────────────────────
  { name: "aide", description: "Affiche la liste des commandes du bot", usage: "/aide", category: "Général" },
  { name: "salut", description: "Le bot te salue", usage: "/salut", category: "Général" },
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
    name: "info-serveur",
    description: "Affiche les informations du serveur",
    usage: "/info-serveur",
    category: "Général",
    dmPermission: false,
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
    usage: "/guildguard status | enable | disable | account-age | raid | quarantine | log | lockdown",
    category: "Sécurité",
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
    name: "protect",
    description: "Configure le rôle personnel protégé contre les sanctions",
    usage: "/protect role | reset | status",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("role", "Définit le rôle Protect", [
        opt(8, "role", "Rôle intouchable", { required: true }),
      ]),
      sub("reset", "Désactive la protection par rôle"),
      sub("status", "Affiche la configuration Protect"),
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
    usage: "/ban membre raison",
    category: "Modération",
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
    usage: "/verify moi | panel",
    category: "Modération",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("moi", "Te donner le rôle de vérification"),
      sub("panel", "Publie le panneau de vérification", [
        opt(7, "salon", "Salon où publier le panneau", { channel_types: [0] }),
      ]),
    ],
  },
  {
    name: "sysp",
    description: "Gestion du système SYS+",
    usage: "/sysp panel ou /sysp role",
    category: "SYS+",
    dmPermission: false,
    options: [
      sub("panel", "Ouvre le centre de contrôle SYS+"),
      sub("audit", "Affiche les dernières actions staff"),
      sub("role", "Configure le rôle Perm SYS+", [opt(8, "role", "Rôle à attribuer comme Perm SYS+", { required: true })]),
    ],
  },
  {
    name: "ticket",
    description: "Gère les tickets de support",
    usage: "/ticket panel | close | add | remove | list",
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
    description: "Gère le solde PND d’un membre (administration)",
    usage: "/pnd ajouter | retirer | definir",
    category: "Économie PND",
    defaultMemberPermissions: manageServer,
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
    description: "Donne un point de réputation à un membre",
    usage: "/rep membre [raison]",
    category: "Social & cartes",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      opt(6, "membre", "Membre à récompenser", { required: true }),
      opt(3, "raison", "Raison (facultative)", { max_length: 200 }),
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
    usage: "/giveaway start | end | list",
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

  // ── DOG ────────────────────────────────────────────────────────────────────
  {
    name: "dog",
    description: "Met un membre en laisse (surnom et rappel vocal)",
    usage: "/dog membre",
    category: "Vocal & DOG",
    defaultMemberPermissions: manageNicknames,
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à mettre en laisse", { required: true })],
  },
  {
    name: "undog",
    description: "Retire la laisse d’un membre",
    usage: "/undog membre",
    category: "Vocal & DOG",
    defaultMemberPermissions: manageNicknames,
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à libérer", { required: true })],
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
    description: "Rend ton salon vocal privé",
    usage: "/pv",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "panel",
    description: "Ouvre le panneau de contrôle de ton salon vocal",
    usage: "/panel",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "voice-request-panel",
    description: "Publie un panneau pour demander l’accès à un salon vocal privé",
    usage: "/voice-request-panel",
    category: "Vocal & DOG",
    defaultMemberPermissions: manageChannels,
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "voc",
    description: "Gère ton salon vocal temporaire",
    usage: "/voc panel | limit | name | claim | lock | unlock | delete",
    category: "Vocal & DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("panel", "Affiche les informations du salon temporaire"),
      sub("limit", "Règle la limite de membres", [
        opt(4, "nombre", "0 = illimité, 1–99", { required: true, min_value: 0, max_value: 99 }),
      ]),
      sub("name", "Renomme le salon temporaire", [
        opt(3, "nom", "Nouveau nom", { required: true, max_length: 100 }),
      ]),
      sub("claim", "Deviens propriétaire si l’ancien a quitté"),
      sub("lock", "Empêche les autres membres de rejoindre"),
      sub("unlock", "Autorise à nouveau les membres à rejoindre"),
      sub("delete", "Supprime ton salon temporaire"),
    ],
  },

  // ── Musique ────────────────────────────────────────────────────────────────
  {
    name: "play",
    description: "Joue une musique ou une playlist YouTube",
    usage: "/play recherche ou lien YouTube",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "recherche", "Nom de la musique ou lien YouTube", { required: true, max_length: 250 })],
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

  // ── Radio PartyNextDoor ────────────────────────────────────────────────────
  {
    name: "radio",
    description: "Gère la radio PartyNextDoor 24/7",
    usage: "/radio status | set | start | stop | clear",
    category: "Musique & radio",
    dmPermission: false,
    requiresBotProcess: true,
    options: [
      sub("status", "Affiche l’état de la radio"),
      sub("set", "Configure et lance la radio (administration)", [
        opt(7, "salon", "Salon vocal de diffusion", { required: true, channel_types: [2] }),
        opt(3, "playlist", "URL de la playlist YouTube", { required: true, max_length: 500 }),
      ]),
      sub("start", "Démarre la radio configurée (administration)"),
      sub("stop", "Arrête la radio sans effacer sa configuration (administration)"),
      sub("clear", "Supprime la configuration radio (administration)"),
    ],
  },
];

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
