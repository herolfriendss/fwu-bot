const MAX_RAW_PLAN_LENGTH = 10_000;
const SNOWFLAKE_RE = /^\d{5,25}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, required = allowed) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("Le plan IA contient des champs inattendus ou manquants.");
  }
}

function cleanName(value, label) {
  if (typeof value !== "string") throw new Error(`${label} invalide.`);
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "＠")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 90 || /[<>`]/.test(name)) {
    throw new Error(`${label} : indique un nom de 2 à 90 caractères.`);
  }
  return name;
}

function cleanChannelName(value) {
  return cleanName(value, "Salon")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 90);
}

/**
 * Parse and validate the untrusted JSON emitted by the PND Intelligence model.
 * This is a proposal validator only; the bot still re-validates the action,
 * requester permissions, guild membership and live Discord resources.
 */
export function parsePndIntelligenceModelPlan(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_PLAN_LENGTH) {
    throw new Error("Réponse du planificateur IA invalide ou trop volumineuse.");
  }

  const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Le planificateur IA n'a pas renvoyé un objet JSON valide.");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Le plan d'action IA est invalide.");
  }

  if (value.type === "none") {
    assertExactKeys(value, ["type", "reason"], ["type"]);
    if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 240)) {
      throw new Error("Motif de refus IA invalide.");
    }
    return { type: "none", ...(value.reason?.trim() ? { reason: value.reason.trim() } : {}) };
  }

  if (value.type === "create_category") {
    assertExactKeys(value, ["type", "name"]);
    return { type: "create_category", name: cleanName(value.name, "Catégorie") };
  }

  if (value.type === "create_text_channel" || value.type === "create_voice_channel") {
    assertExactKeys(value, ["type", "name", "categoryName"], ["type", "name"]);
    const name = cleanChannelName(value.name);
    if (name.length < 2) throw new Error("Nom de salon invalide.");
    const categoryName = value.categoryName == null ? null : cleanName(value.categoryName, "Catégorie");
    return { type: value.type, name, categoryName };
  }

  if (value.type === "create_role") {
    assertExactKeys(value, ["type", "name"]);
    return { type: "create_role", name: cleanName(value.name, "Nom du rôle") };
  }

  if (value.type === "rename_channel") {
    assertExactKeys(value, ["type", "channelId", "name"]);
    if (typeof value.channelId !== "string" || !SNOWFLAKE_RE.test(value.channelId)) throw new Error("Identifiant du salon cible invalide.");
    return { type: "rename_channel", channelId: value.channelId, name: cleanChannelName(value.name) };
  }

  if (value.type === "set_channel_topic") {
    assertExactKeys(value, ["type", "channelId", "topic"]);
    if (typeof value.channelId !== "string" || !SNOWFLAKE_RE.test(value.channelId) || typeof value.topic !== "string" || value.topic.length > 1024) {
      throw new Error("Sujet ou identifiant du salon invalide.");
    }
    return { type: "set_channel_topic", channelId: value.channelId, topic: value.topic.trim() };
  }

  if (value.type === "set_channel_slowmode") {
    assertExactKeys(value, ["type", "channelId", "seconds"]);
    if (typeof value.channelId !== "string" || !SNOWFLAKE_RE.test(value.channelId) || !Number.isSafeInteger(value.seconds) || value.seconds < 0 || value.seconds > 21600) {
      throw new Error("Configuration du mode lent invalide.");
    }
    return { type: "set_channel_slowmode", channelId: value.channelId, seconds: value.seconds };
  }

  if (value.type === "send_announcement") {
    assertExactKeys(value, ["type", "channelId", "content"]);
    if (typeof value.channelId !== "string" || !SNOWFLAKE_RE.test(value.channelId)) {
      throw new Error("Identifiant du salon d'annonce invalide.");
    }
    if (typeof value.content !== "string") throw new Error("Contenu d'annonce invalide.");
    const content = value.content.trim();
    if (content.length < 3 || content.length > 1700) {
      throw new Error("Une annonce doit contenir entre 3 et 1 700 caractères.");
    }
    return { type: "send_announcement", channelId: value.channelId, content };
  }

  throw new Error("Action proposée hors de la liste autorisée de PND Intelligence.");
}
