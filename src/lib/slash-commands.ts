// Shared, client-safe definitions of the bot's slash commands.
// No secrets here: imported by the panel UI and by the interactions server module.

export type SlashOption = {
  type: number; // 3 = STRING, 4 = INTEGER
  name: string;
  description: string;
  required?: boolean;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  options?: SlashOption[];
};

export type SlashCommandDef = {
  name: string;
  description: string;
  usage: string;
  options?: SlashOption[];
  defaultMemberPermissions?: string; // Discord permission bitfield as string
  dmPermission?: boolean;
};

const opt = (type: number, name: string, description: string, extra: Partial<SlashOption> = {}): SlashOption => ({
  type,
  name,
  description,
  ...extra,
});

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "aide", description: "Affiche la liste des commandes du bot", usage: "/aide" },
  { name: "salut", description: "Le bot te salue", usage: "/salut" },
  { name: "status", description: "Affiche l’état du bot et sa durée de fonctionnement", usage: "/status" },
  {
    name: "sondage",
    description: "Crée un sondage dans ce salon",
    usage: "/sondage question option1 option2 …",
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
    dmPermission: false,
  },
  {
    name: "sysp",
    description: "Gestion du système SYS+",
    usage: "/sysp panel ou /sysp role",
    dmPermission: false,
    options: [
      {
        type: 1,
        name: "panel",
        description: "Ouvre le centre de contrôle SYS+",
      },
      {
        type: 1,
        name: "role",
        description: "Configure le rôle Perm SYS+",
        options: [
          opt(8, "role", "Rôle à attribuer comme Perm SYS+", { required: true }),
        ],
      },
    ],
  },
  {
    name: "nettoyer",
    description: "Supprime les derniers messages de ce salon",
    usage: "/nettoyer nombre",
    defaultMemberPermissions: "8192", // MANAGE_MESSAGES
    dmPermission: false,
    options: [opt(4, "nombre", "Nombre de messages à supprimer (1–100)", { required: true, min_value: 1, max_value: 100 })],
  },
];

// Strip panel-only fields so the payload is a valid Discord API command object.
export const toDiscordCommand = (c: SlashCommandDef) => ({
  name: c.name,
  description: c.description,
  type: 1,
  ...(c.defaultMemberPermissions ? { default_member_permissions: c.defaultMemberPermissions } : {}),
  ...(c.dmPermission === false ? { dm_permission: false } : {}),
  ...(c.options?.length
    ? {
        options: c.options.map((o) => ({
          type: o.type,
          name: o.name,
          description: o.description,
          ...(o.required !== undefined ? { required: o.required } : {}),
          ...(o.max_length !== undefined ? { max_length: o.max_length } : {}),
          ...(o.min_value !== undefined ? { min_value: o.min_value } : {}),
          ...(o.max_value !== undefined ? { max_value: o.max_value } : {}),
          ...(o.options?.length ? { options: o.options.map((sub) => ({
            type: sub.type,
            name: sub.name,
            description: sub.description,
            ...(sub.required !== undefined ? { required: sub.required } : {}),
            ...(sub.options?.length ? { options: sub.options.map((nested) => ({
              type: nested.type,
              name: nested.name,
              description: nested.description,
              ...(nested.required !== undefined ? { required: nested.required } : {}),
            })) } : {}),
          })) } : {}),
        })),
      }
    : {}),
});
