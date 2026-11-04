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
  {
    name: "sysp",
    description: "Gestion du système SYS+",
    usage: "/sysp panel ou /sysp role",
    category: "SYS+",
    dmPermission: false,
    options: [
      sub("panel", "Ouvre le centre de contrôle SYS+"),
      sub("role", "Configure le rôle Perm SYS+", [opt(8, "role", "Rôle à attribuer comme Perm SYS+", { required: true })]),
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

  // ── DOG ────────────────────────────────────────────────────────────────────
  {
    name: "dog",
    description: "Met un membre en laisse (surnom et rappel vocal)",
    usage: "/dog membre",
    category: "DOG",
    defaultMemberPermissions: manageNicknames,
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à mettre en laisse", { required: true })],
  },
  {
    name: "undog",
    description: "Retire la laisse d’un membre",
    usage: "/undog membre",
    category: "DOG",
    defaultMemberPermissions: manageNicknames,
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à libérer", { required: true })],
  },
  {
    name: "doginfo",
    description: "Affiche la laisse DOG d’un membre",
    usage: "/doginfo membre",
    category: "DOG",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à consulter", { required: true })],
  },

  // ── Vocal ──────────────────────────────────────────────────────────────────
  {
    name: "access",
    description: "Autorise un membre à rejoindre ton salon vocal",
    usage: "/access membre",
    category: "Vocal",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à autoriser", { required: true })],
  },
  {
    name: "unaccess",
    description: "Retire l’accès d’un membre à ton salon vocal",
    usage: "/unaccess membre",
    category: "Vocal",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(6, "membre", "Membre à retirer de la liste d’accès", { required: true })],
  },
  {
    name: "pv",
    description: "Rend ton salon vocal privé",
    usage: "/pv",
    category: "Vocal",
    dmPermission: false,
    requiresBotProcess: true,
  },
  {
    name: "panel",
    description: "Ouvre le panneau de contrôle de ton salon vocal",
    usage: "/panel",
    category: "Vocal",
    dmPermission: false,
    requiresBotProcess: true,
  },

  // ── Musique ────────────────────────────────────────────────────────────────
  {
    name: "play",
    description: "Joue une musique ou une playlist YouTube",
    usage: "/play recherche ou lien YouTube",
    category: "Musique",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(3, "recherche", "Nom de la musique ou lien YouTube", { required: true, max_length: 250 })],
  },
  { name: "pause", description: "Met la musique en pause", usage: "/pause", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "resume", description: "Reprend la lecture de la musique", usage: "/resume", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "skip", description: "Passe au titre suivant", usage: "/skip", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "stop", description: "Arrête la musique et vide la file", usage: "/stop", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "queue", description: "Affiche la file d’attente musicale", usage: "/queue", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "nowplaying", description: "Affiche le titre en cours de lecture", usage: "/nowplaying", category: "Musique", dmPermission: false, requiresBotProcess: true },
  {
    name: "volume",
    description: "Règle le volume de la musique",
    usage: "/volume niveau",
    category: "Musique",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "niveau", "Volume entre 0 et 100", { required: true, min_value: 0, max_value: 100 })],
  },
  {
    name: "loop",
    description: "Change le mode de répétition",
    usage: "/loop mode",
    category: "Musique",
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
  { name: "shuffle", description: "Mélange la file d’attente musicale", usage: "/shuffle", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "clearqueue", description: "Vide la file d’attente musicale", usage: "/clearqueue", category: "Musique", dmPermission: false, requiresBotProcess: true },
  {
    name: "remove",
    description: "Retire un titre de la file d’attente",
    usage: "/remove position",
    category: "Musique",
    dmPermission: false,
    requiresBotProcess: true,
    options: [opt(4, "position", "Position du titre dans /queue", { required: true, min_value: 1, max_value: 100 })],
  },
  { name: "join", description: "Connecte le bot à ton salon vocal", usage: "/join", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "leave", description: "Déconnecte le bot du salon vocal", usage: "/leave", category: "Musique", dmPermission: false, requiresBotProcess: true },
  { name: "musicpanel", description: "Affiche le panneau de contrôle musical", usage: "/musicpanel", category: "Musique", dmPermission: false, requiresBotProcess: true },

  // ── Radio PartyNextDoor ────────────────────────────────────────────────────
  {
    name: "radio",
    description: "Gère la radio PartyNextDoor 24/7",
    usage: "/radio status | set | start | stop | clear",
    category: "Radio",
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
