export const SETUP_MODULES = Object.freeze({
  spam: {
    label: "Anti-spam et mentions",
    description: "Supprime les rafales de messages et les mentions de masse, puis met l’auteur en sourdine.",
    fields: [
      { key: "enabled", label: "Protection activée (oui/non)", kind: "boolean" },
      { key: "maxMessages", label: "Messages maximum dans la fenêtre", kind: "integer", min: 2, max: 30 },
      { key: "perSeconds", label: "Fenêtre anti-spam (secondes)", kind: "integer", min: 1, max: 60 },
      { key: "maxMentions", label: "Mentions maximum par message", kind: "integer", min: 2, max: 20 },
      { key: "timeoutMinutes", label: "Timeout anti-spam (minutes)", kind: "integer", min: 1, max: 1440 },
    ],
  },
  guildGuard: {
    label: "Sécurité anti-raid",
    description: "Surveille les nouveaux comptes et protège le serveur contre les raids.",
    fields: [
      {
        key: "enabled",
        label: "Module activé (oui/non)",
        kind: "boolean",
        placeholder: "oui ou non",
      },
      {
        key: "minAccountAgeDays",
        label: "Âge minimum du compte (jours)",
        kind: "integer",
        min: 0,
        max: 365,
      },
      {
        key: "youngAccountAction",
        label: "Action compte récent",
        kind: "enum",
        values: ["log", "kick", "quarantine"],
        choices: { log: "Noter dans le journal", kick: "Expulser", quarantine: "Mettre en quarantaine" },
        aliases: { journal: "log", noter: "log", expulser: "kick", exclure: "kick", quarantaine: "quarantine" },
        placeholder: "journal, expulser ou quarantaine",
      },
      { key: "quarantineRoleId", label: "Rôle de quarantaine (ID)", kind: "role", required: false },
      {
        key: "logChannelId",
        label: "Salon de journalisation (ID)",
        kind: "textChannel",
        required: false,
      },
    ],
  },
  moderation: {
    label: "Modération",
    description: "Journal des sanctions et durée de vie des avertissements.",
    fields: [
      {
        key: "logChannelId",
        label: "Salon des journaux (ID)",
        kind: "textChannel",
        required: false,
      },
      { key: "dmOnWarn", label: "Informer en message privé (oui/non)", kind: "boolean" },
      {
        key: "warnExpiryDays",
        label: "Expiration des avertissements (jours)",
        kind: "integer",
        min: 0,
        max: 365,
      },
    ],
  },
  verification: {
    label: "Vérification des membres",
    description: "Les nouveaux membres doivent valider un panneau pour obtenir l’accès.",
    fields: [
      { key: "enabled", label: "Module activé (oui/non)", kind: "boolean" },
      { key: "roleId", label: "Rôle validé (ID)", kind: "role", required: false },
      {
        key: "channelId",
        label: "Salon de vérification (ID)",
        kind: "textChannel",
        required: false,
      },
      {
        key: "minAccountAgeDays",
        label: "Âge minimum du compte (jours)",
        kind: "integer",
        min: 0,
        max: 365,
      },
      {
        key: "message",
        label: "Texte du panneau",
        kind: "text",
        max: 180,
        placeholder: "Message affiché dans le panneau",
      },
    ],
  },
  tickets: {
    label: "Tickets communautaires",
    description: "Les membres ouvrent un ticket privé pour contacter l’équipe.",
    fields: [
      { key: "enabled", label: "Module activé (oui/non)", kind: "boolean" },
      { key: "categoryId", label: "Catégorie des tickets (ID)", kind: "category", required: false },
      { key: "supportRoleId", label: "Rôle support (ID)", kind: "role", required: false },
      {
        key: "logChannelId",
        label: "Salon des journaux (ID)",
        kind: "textChannel",
        required: false,
      },
      {
        key: "maxOpenPerUser",
        label: "Tickets ouverts par membre",
        kind: "integer",
        min: 1,
        max: 5,
      },
    ],
  },
  tempVoice: {
    label: "Salons vocaux temporaires",
    description: "Rejoindre le vocal de création ouvre un salon vocal personnel.",
    fields: [
      { key: "enabled", label: "Module activé (oui/non)", kind: "boolean" },
      {
        key: "hubChannelId",
        label: "Vocal de création (ID)",
        kind: "voiceChannel",
        required: false,
      },
      { key: "categoryId", label: "Catégorie des vocaux (ID)", kind: "category", required: false },
      {
        key: "defaultLimit",
        label: "Limite de membres (0 = illimité)",
        kind: "integer",
        min: 0,
        max: 99,
      },
      {
        key: "nameTemplate",
        label: "Modèle de nom ({user})",
        kind: "text",
        max: 80,
        placeholder: "Salon de {user}",
      },
    ],
  },
  automation: {
    label: "Automatisations de bienvenue",
    description: "Rôles donnés automatiquement et message privé de bienvenue.",
    fields: [
      {
        key: "autoRoleIds",
        label: "Rôles auto (IDs séparés par virgule)",
        kind: "roleList",
        required: false,
        placeholder: "ID1, ID2 (10 maximum)",
      },
      { key: "welcomeDm", label: "Message privé de bienvenue (oui/non)", kind: "boolean" },
      {
        key: "welcomeDmMessage",
        label: "Texte du message privé",
        kind: "text",
        max: 500,
        placeholder: "Utilise {server} pour le nom du serveur",
      },
    ],
  },
  dog: {
    label: "DOG — laisses par SYS+",
    description: "Nombre de laisses qu’un SYS+ peut poser en même temps.",
    fields: [
      {
        key: "maxActiveLeashes",
        label: "Laisses actives maximum par SYS+ (1 à 10)",
        kind: "integer",
        min: 1,
        max: 10,
        default: 3,
      },
    ],
  },
  liveAlerts: {
    label: "Alertes de démarrage LIVE",
    description: "Annonce dans un salon quand un créateur lance un live.",
    fields: [
      { key: "enabled", label: "Alertes activées (oui/non)", kind: "boolean" },
      { key: "channelId", label: "Salon de publication (ID ou mention)", kind: "textChannel", required: false },
      { key: "animated", label: "Visuels animés (oui/non)", kind: "boolean" },
      {
        key: "creators",
        label: "Créateurs et flux RSS/Atom (JSON)",
        kind: "liveCreators",
        max: 3500,
        placeholder: '[{"id":"creator-1","platform":"youtube","displayName":"Nom","feedUrl":"https://…"}]',
      },
    ],
  },
});

export function parseSetupId(value, kind) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const patterns = {
    role: /^(?:<@&(\d{5,25})>|(\d{5,25}))$/,
    channel: /^(?:<#(\d{5,25})>|(\d{5,25}))$/,
  };
  const normalizedKind = kind === "role" ? "role" : "channel";
  const match = patterns[normalizedKind]?.exec(text);
  return match ? (match[1] ?? match[2]) : null;
}

export function parseSetupBoolean(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["oui", "o", "yes", "y", "true", "on", "1"].includes(normalized)) return true;
  if (["non", "n", "no", "false", "off", "0"].includes(normalized)) return false;
  throw new Error("Entre oui ou non pour ce réglage.");
}

export function setupHasToggle(module) {
  return Boolean(SETUP_MODULES[module]?.fields.some((field) => field.key === "enabled"));
}

/** Champs affichés dans le formulaire : l’activation passe par un bouton dédié. */
export function setupFormFields(module) {
  return (SETUP_MODULES[module]?.fields ?? []).filter((field) => field.key !== "enabled");
}

/** Vérifie qu’un module activé possède les salons/rôles indispensables. */
export function setupRequirementError(module, next) {
  if (module === "verification" && next.enabled && (!next.roleId || !next.channelId)) {
    return "La vérification active demande un rôle validé et un salon configurés.";
  }
  if (module === "tempVoice" && next.enabled && (!next.hubChannelId || !next.categoryId)) {
    return "Les salons vocaux temporaires actifs demandent un vocal de création et une catégorie.";
  }
  if (module === "liveAlerts" && next.enabled && (!next.channelId || !next.creators?.length)) {
    return "Les alertes LIVE activées demandent un salon et au moins un flux de créateur.";
  }
  return null;
}

/**
 * Lit les valeurs saisies. Un champ absent de `rawValues` (par exemple
 * `enabled`, géré par le bouton Activer/Désactiver) garde sa valeur actuelle.
 */
export function parseSetupModule(module, rawValues, current = {}) {
  const definition = SETUP_MODULES[module];
  if (!definition) throw new Error("Ce module n’est pas configurable avec `/setup`.");
  const next = { ...current };
  for (const field of definition.fields) {
    if (!Object.hasOwn(rawValues, field.key)) continue;
    const raw = String(rawValues[field.key] ?? "").trim();
    if (field.kind === "boolean") next[field.key] = parseSetupBoolean(raw);
    else if (field.kind === "integer") {
      if (!/^\d+$/.test(raw)) throw new Error(`${field.label} doit être un nombre entier.`);
      const number = Number(raw);
      if (number < field.min || number > field.max)
        throw new Error(`${field.label} doit être compris entre ${field.min} et ${field.max}.`);
      next[field.key] = number;
    } else if (field.kind === "enum") {
      const value = field.values.includes(raw) ? raw : field.aliases?.[raw.toLowerCase()];
      if (!value) {
        throw new Error(`${field.label} doit valoir : ${field.placeholder ?? field.values.join(", ")}.`);
      }
      next[field.key] = value;
    } else if (
      field.kind === "role" ||
      field.kind === "textChannel" ||
      field.kind === "category" ||
      field.kind === "voiceChannel"
    ) {
      const id = raw ? parseSetupId(raw, field.kind === "role" ? "role" : "channel") : null;
      if (raw && !id)
        throw new Error(`${field.label} doit être un ID Discord ou une mention valide.`);
      next[field.key] = id;
    } else if (field.kind === "roleList") {
      const ids = raw ? raw.split(",").map((part) => parseSetupId(part, "role")) : [];
      if (ids.some((id) => !id) || ids.length > 10)
        throw new Error(`${field.label} accepte jusqu’à 10 IDs ou mentions de rôles.`);
      next[field.key] = [...new Set(ids)];
    } else if (field.kind === "liveCreators") {
      let creators;
      try { creators = raw ? JSON.parse(raw) : []; }
      catch { throw new Error(`${field.label} doit être un JSON valide.`); }
      if (!Array.isArray(creators) || creators.length > 30) throw new Error(`${field.label} accepte une liste de 0 à 30 créateurs.`);
      const ids = new Set();
      next[field.key] = creators.map((creator, index) => {
        const id = String(creator?.id ?? `creator-${index + 1}`).trim();
        const platform = String(creator?.platform ?? "").trim().toLowerCase();
        const displayName = String(creator?.displayName ?? "").trim().slice(0, 80);
        const feedUrl = String(creator?.feedUrl ?? "").trim().slice(0, 1000);
        let url;
        try { url = new URL(feedUrl); } catch { url = null; }
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || ids.has(id)) throw new Error(`${field.label} contient un identifiant invalide ou en double.`);
        if (!["youtube", "tiktok", "twitch", "other"].includes(platform)) throw new Error(`${field.label} contient une plateforme invalide (youtube, tiktok, twitch, other).`);
        if (!displayName) throw new Error(`${field.label} contient un nom de créateur vide.`);
        if (!url || url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error(`${field.label} accepte uniquement des URL HTTPS publiques valides.`);
        ids.add(id);
        return { id, platform, displayName, feedUrl: url.toString() };
      });
    } else if (field.kind === "text") {
      if (!raw) throw new Error(`${field.label} ne peut pas être vide.`);
      if (raw.length > field.max)
        throw new Error(`${field.label} est limité à ${field.max} caractères.`);
      next[field.key] = raw;
    }
  }
  const requirement = setupRequirementError(module, next);
  if (requirement) throw new Error(requirement);
  return next;
}

export function setupChangedKeys(previous, next) {
  return Object.keys(next).filter(
    (key) => JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(next[key] ?? null),
  );
}
