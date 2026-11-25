// Her? V4 — Vocal V2 : règles pures des salons temporaires.
export function renderVoiceName(template, displayName) {
  const safe = String(displayName ?? "Membre").replace(/[\r\n\t]+/g, " ").trim().slice(0, 60) || "Membre";
  const rendered = String(template ?? "Salon de {user}").replaceAll("{user}", safe).replace(/[\r\n\t]+/g, " ").trim().slice(0, 100);
  return rendered || `Salon de ${safe}`;
}

export function clampVoiceLimit(raw) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, value));
}

export function canManageTempVoice({ ownerId, userId, hasManageChannels = false }) {
  if (!userId) return false;
  return userId === ownerId || Boolean(hasManageChannels);
}

export function tempVoiceNameIsValid(raw) {
  const name = String(raw ?? "").trim();
  return name.length >= 1 && name.length <= 100 && !/[\r\n\t]/.test(name);
}

/** Délai de grâce avant de supprimer un salon vide : 0 à 300 secondes. */
export const MAX_EMPTY_DELETE_SECONDS = 300;
export function clampEmptyDeleteSeconds(raw) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_EMPTY_DELETE_SECONDS, Math.max(0, value));
}

/**
 * Discord n'accepte que 2 renommages de salon toutes les 10 minutes. Au-delà,
 * discord.js attend en silence et la commande semble bloquée : on refuse avant.
 */
export const RENAME_WINDOW_MS = 10 * 60_000;
export const RENAMES_PER_WINDOW = 2;
export function renameAllowed(history = [], now = Date.now()) {
  const recent = history.filter((at) => now - at < RENAME_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < RENAMES_PER_WINDOW) return { allowed: true, recent, retryAt: null };
  return { allowed: false, recent, retryAt: recent[recent.length - RENAMES_PER_WINDOW] + RENAME_WINDOW_MS };
}

/**
 * Nouveau propriétaire quand l'ancien quitte son salon : le premier membre
 * humain encore présent (ordre fourni par l'appelant), jamais un bot.
 */
export function pickNextOwner(members = [], previousOwnerId = null) {
  const next = members.find((member) => member && !member.bot && member.id !== previousOwnerId);
  return next?.id ?? null;
}

/** Listes personnelles du propriétaire : membres de confiance et membres bloqués. */
export const TEMP_VOICE_LIST_KINDS = Object.freeze(["trusted", "blocked"]);
export const MAX_LIST_ENTRIES = 25;
export function listAddRefusal({ kind, ownerId, targetId, targetIsBot = false, currentSize = 0, alreadyListed = false }) {
  if (!TEMP_VOICE_LIST_KINDS.includes(kind)) return "Liste inconnue.";
  if (!targetId || targetIsBot) return "Choisis un membre (pas un bot).";
  if (targetId === ownerId) return "Tu ne peux pas t'ajouter toi-même.";
  if (!alreadyListed && currentSize >= MAX_LIST_ENTRIES) return `Ta liste est pleine (${MAX_LIST_ENTRIES} membres maximum). Retire quelqu'un d'abord.`;
  return null;
}

/**
 * Permissions à appliquer pour les listes du propriétaire. Un membre bloqué
 * qui est mieux placé que le propriétaire (rang) n'est pas bloqué.
 */
export function listOverwritePlan(entries = [], { outranksOwner = () => false } = {}) {
  const plan = [];
  for (const entry of entries) {
    if (entry.kind === "trusted") plan.push({ id: entry.targetId, Connect: true, ViewChannel: true });
    else if (entry.kind === "blocked" && !outranksOwner(entry.targetId)) plan.push({ id: entry.targetId, Connect: false });
  }
  return plan;
}

/** Identifiants des composants du panneau : tvc:<action>:<salon>. */
export const PANEL_ACTIONS = Object.freeze([
  "lock", "unlock", "limit", "name", "claim", "delete", "info",
  "invite", "kick", "transfer", "trust", "block", "unlist",
]);
export function buildPanelId(action, channelId) {
  return `tvc:${action}:${channelId}`;
}
export function parsePanelId(customId) {
  const match = /^tvc:([a-z]+):(\d{5,25})$/.exec(String(customId ?? ""));
  if (!match || !PANEL_ACTIONS.includes(match[1])) return null;
  return { action: match[1], channelId: match[2] };
}
