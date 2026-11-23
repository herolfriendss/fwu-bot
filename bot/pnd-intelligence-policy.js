export const PND_INTELLIGENCE_ACTION_TYPES = Object.freeze([
  "create_category",
  "create_text_channel",
  "create_voice_channel",
  "create_role",
  "rename_channel",
  "set_channel_topic",
  "set_channel_slowmode",
  "send_announcement",
]);

function cleanName(value, label) {
  if (typeof value !== "string") throw new Error(`${label} : nom invalide.`);
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/@/g, "＠").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 90 || /[<>`]/.test(name)) throw new Error(`${label} : indique un nom de 2 à 90 caractères.`);
  return name;
}

export function parsePndIntelligenceRequest(input) {
  const raw = String(input ?? "").trim();
  let match = raw.match(/^(?:crée|creer|créer)\s+(?:une?\s+)?catégorie\s+(.+)$/i);
  if (match) return { type: "create_category", name: cleanName(match[1], "Catégorie") };

  match = raw.match(/^(?:crée|creer|créer)\s+(?:un\s+)?salon\s+(texte|vocal)\s+(.+?)(?:\s+dans\s+(?:la\s+)?catégorie\s+(.+))?$/i);
  if (match) {
    const channelName = cleanName(match[2], "Salon").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 90);
    if (channelName.length < 2) throw new Error("Nom de salon invalide.");
    return { type: match[1].toLowerCase() === "texte" ? "create_text_channel" : "create_voice_channel", name: channelName, categoryName: match[3] ? cleanName(match[3], "Catégorie") : null };
  }

  match = raw.match(/^(?:crée|cree|créer|creer)\s+(?:un\s+)?rôle\s+(.+)$/i);
  if (match) return { type: "create_role", name: cleanName(match[1], "Nom du rôle") };

  match = raw.match(/^(?:renomme|renommer)\s+(?:le\s+)?salon\s+<#(\d{5,25})>\s+(?:en|pour)\s+(.+)$/i);
  if (match) return { type: "rename_channel", channelId: match[1], name: cleanName(match[2], "Nom du salon").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 100) };

  match = raw.match(/^(?:change|modifie|modifier)\s+(?:le\s+)?sujet\s+(?:du\s+)?salon\s+<#(\d{5,25})>\s+(?:en|pour)\s+([\s\S]+)$/i);
  if (match) {
    const topic = match[2].trim();
    if (topic.length > 1024) throw new Error("Le sujet d'un salon ne peut pas dépasser 1 024 caractères.");
    return { type: "set_channel_topic", channelId: match[1], topic };
  }

  match = raw.match(/^(?:active|definis|définis|regle|règle)\s+(?:le\s+)?mode\s+lent\s+(?:a|à)\s+(\d{1,5})\s*(s|sec|seconde?s|min|minute?s)\s+(?:sur|dans)\s+<#(\d{5,25})>$/i);
  if (match) {
    const amount = Number(match[1]);
    const seconds = /^(?:min|minute)/i.test(match[2]) ? amount * 60 : amount;
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 21600) throw new Error("Le mode lent doit être compris entre 0 et 21 600 secondes.");
    return { type: "set_channel_slowmode", channelId: match[3], seconds };
  }

  match = raw.match(/^(?:désactive|desactive)\s+(?:le\s+)?mode\s+lent\s+(?:sur|dans)\s+<#(\d{5,25})>$/i);
  if (match) return { type: "set_channel_slowmode", channelId: match[1], seconds: 0 };

  match = raw.match(/^(?:publie|publier|envoie|envoyer)\s+(?:une?\s+)?annonce\s+(.+)\s+dans\s+<#(\d{5,25})>$/i);
  if (match) {
    const content = match[1].trim();
    if (content.length < 3 || content.length > 1700) throw new Error("Une annonce doit contenir entre 3 et 1 700 caractères.");
    return { type: "send_announcement", content, channelId: match[2] };
  }
  throw new Error("Je ne reconnais pas encore cette action. Essaie : `crée une catégorie Staff`, `crée un salon texte annonces dans la catégorie Staff` ou `publie une annonce ... dans <#salon>`. ");
}

export function validatePndIntelligenceAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Plan d'action invalide.");
  if (value.type === "create_category") return { type: value.type, name: cleanName(value.name, "Catégorie") };
  if (value.type === "create_text_channel" || value.type === "create_voice_channel") {
    const name = cleanName(value.name, "Salon").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 90);
    if (name.length < 2) throw new Error("Nom de salon invalide.");
    const categoryName = value.categoryName == null ? null : cleanName(value.categoryName, "Catégorie");
    return { type: value.type, name, categoryName };
  }
  if (value.type === "create_role") {
    const name = cleanName(value.name, "Nom du rôle");
    if (name.length < 2 || name.length > 100) throw new Error("Nom de rôle invalide.");
    return { type: value.type, name };
  }
  if (value.type === "rename_channel") {
    if (typeof value.channelId !== "string" || !/^\d{5,25}$/.test(value.channelId)) throw new Error("Salon cible invalide.");
    const name = cleanName(value.name, "Nom du salon").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 100);
    if (name.length < 2) throw new Error("Nom de salon invalide.");
    return { type: value.type, channelId: value.channelId, name };
  }
  if (value.type === "set_channel_topic") {
    if (typeof value.topic !== "string") throw new Error("Sujet ou salon cible invalide.");
    const topic = value.topic.trim();
    if (topic.length > 1024 || typeof value.channelId !== "string" || !/^\d{5,25}$/.test(value.channelId)) throw new Error("Sujet ou salon cible invalide.");
    return { type: value.type, channelId: value.channelId, topic };
  }
  if (value.type === "set_channel_slowmode") {
    if (typeof value.channelId !== "string" || !/^\d{5,25}$/.test(value.channelId) || !Number.isSafeInteger(value.seconds) || value.seconds < 0 || value.seconds > 21600) throw new Error("Configuration du mode lent invalide.");
    return { type: value.type, channelId: value.channelId, seconds: value.seconds };
  }
  if (value.type === "send_announcement") {
    if (typeof value.content !== "string") throw new Error("Plan d'annonce invalide : contenu ou salon manquant.");
    const content = value.content.trim();
    if (content.length < 3 || content.length > 1700 || typeof value.channelId !== "string" || !/^\d{5,25}$/.test(value.channelId)) throw new Error("Plan d'annonce invalide : contenu ou salon manquant.");
    return { type: value.type, content, channelId: value.channelId };
  }
  throw new Error("Cette action ne fait pas partie des outils autorisés de PND Intelligence.");
}
