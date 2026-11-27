// Ordres de la console du site (redémarrage individuel). Fonctions pures, testées.
// Le site dépose l'ordre ; il arrive dans la réponse du rapport de statut (toutes les 20 s, BOT_SYNC_SECRET).
// Rien d'autre qu'un redémarrage n'existe, et aucun texte reçu n'est jamais exécuté.

/** Même valeur que COMMAND_MAX_AGE_AT_BOT_MS dans src/lib/bot-control.ts (un test vérifie l'égalité). */
export const COMMAND_MAX_AGE_MS = 5 * 60_000;

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} body corps JSON de la réponse du site
 * @param {{ now?: number, seen?: Set<string>, enabled?: boolean }} options
 * @returns {null | { action: "restart", id: string } | { action: "ignore", reason: string }}
 *   null = aucun ordre. « ignore » = un ordre est arrivé mais ne doit pas être exécuté (il est signalé).
 */
export function decideRemoteCommand(body, { now = Date.now(), seen = new Set(), enabled = true } = {}) {
  if (!body || typeof body !== "object") return null;
  const command = /** @type {{ command?: unknown }} */ (body).command;
  if (command === null || command === undefined) return null;
  if (!enabled) return { action: "ignore", reason: "disabled" };
  if (typeof command !== "object" || Array.isArray(command)) return { action: "ignore", reason: "invalid" };
  const { id, action, issuedAt } = /** @type {Record<string, unknown>} */ (command);
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return { action: "ignore", reason: "invalid" };
  if (action !== "restart") return { action: "ignore", reason: "unknown-action" };
  if (seen.has(id)) return { action: "ignore", reason: "already-handled" };
  const issued = typeof issuedAt === "string" ? Date.parse(issuedAt) : NaN;
  if (!Number.isFinite(issued)) return { action: "ignore", reason: "invalid" };
  if (now - issued > COMMAND_MAX_AGE_MS) return { action: "ignore", reason: "stale" };
  if (issued - now > 60_000) return { action: "ignore", reason: "future" };
  return { action: "restart", id };
}
