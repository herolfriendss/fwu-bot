import { createHmac } from "node:crypto";

/**
 * Règles de vie privée de l'Observateur.
 * - Les identifiants des membres ne sont jamais stockés en clair : on garde
 *   une empreinte (HMAC) qui ne permet pas de retrouver la personne.
 * - Le texte est nettoyé avant d'être stocké ou envoyé à l'IA : mentions,
 *   liens, e-mails, numéros et longues suites de chiffres sont masqués.
 */

export const EXCERPT_MAX_CHARS = 300;
export const EXCERPT_RETENTION_DAYS = 7;

export function pseudonymize(userId, secret) {
  return createHmac("sha256", secret).update(String(userId)).digest("hex").slice(0, 16);
}

export function redact(text) {
  let out = String(text ?? "");
  out = out.replace(/<@!?\d+>/g, "[membre]");
  out = out.replace(/<@&\d+>/g, "[rôle]");
  out = out.replace(/<#\d+>/g, "[salon]");
  out = out.replace(/<a?:\w+:\d+>/g, "[emoji]");
  out = out.replace(/@(everyone|here)/g, "[mention-groupe]");
  out = out.replace(/(discord\.gg|discord(?:app)?\.com\/invite)\/\S+/gi, "[invitation]");
  out = out.replace(/https?:\/\/\S+/gi, "[lien]");
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]");
  // Jetons ou clés : longues chaînes sans espace mêlant lettres et chiffres
  out = out.replace(/\b(?=[\w.-]*\d)(?=[\w.-]*[A-Za-z])[\w.-]{24,}\b/g, "[secret]");
  out = out.replace(/\+?\d[\d .-]{7,}\d/g, "[numéro]");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > EXCERPT_MAX_CHARS) out = `${out.slice(0, EXCERPT_MAX_CHARS - 1)}…`;
  return out;
}

const SIGNAL_PATTERNS = [
  ["bug", /\b(bug|beug|bugg?é|crash|planté|plante)\b/i],
  ["bug", /\b(marche|fonctionne|répond|repond)\s+(pas|plus)\b/i],
  ["bug", /\b(erreur|error)\b/i],
  ["idee", /\b(suggestion|idée|idee|proposition)\b/i],
  ["idee", /\b(ce serait bien|ça serait bien|il faudrait|faudrait|on pourrait|vous pourriez)\b/i],
  ["question", /\b(comment|pourquoi|où|ou est|c'est quoi|quelqu'un sait)\b.*\?\s*$/i],
];

/** Dit si un message de membre mérite d'être gardé comme extrait, et pourquoi. */
export function classifySignal(text) {
  const t = String(text ?? "");
  if (t.trim().length < 8) return null;
  for (const [kind, re] of SIGNAL_PATTERNS) if (re.test(t)) return kind;
  return null;
}

const BOT_ERROR = /(❌|⚠️|\berreur\b|\berror\b|\béchec\b|impossible de|une erreur est survenue)/i;

/** Dit si un message d'un des 5 bots ressemble à un message d'erreur. */
export function looksLikeBotError(text) {
  return BOT_ERROR.test(String(text ?? ""));
}

/** Remplace les empreintes par « membre A », « membre B »… pour l'IA. */
export function labelAuthors(excerpts) {
  const labels = new Map();
  const label = (hash) => {
    if (!hash) return "bot";
    if (!labels.has(hash)) {
      const n = labels.size;
      const letters = n < 26 ? String.fromCharCode(65 + n) : `${String.fromCharCode(65 + (n % 26))}${Math.floor(n / 26)}`;
      labels.set(hash, `membre ${letters}`);
    }
    return labels.get(hash);
  };
  return excerpts.map((e) => ({ ...e, author: label(e.author_hash), author_hash: undefined }));
}
