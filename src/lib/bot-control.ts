// Redémarrage individuel des bots depuis la console du site : règles pures, partagées par le serveur,
// le bot et les tests. Plain, erasable TypeScript only (le bot Oracle importe ce fichier directement).
import { BOT_PROFILE_IDS, isBotProfileId, type BotProfileId } from "./bot-profiles";

export const RESTART_ACTION = "restart" as const;
/** Un ordre jamais livré (bot hors ligne) expire au bout de 2 minutes : il ne doit pas partir au hasard plus tard. */
export const COMMAND_TTL_MS = 2 * 60_000;
/** Délai minimum entre deux redémarrages demandés pour le même bot. */
export const RESTART_COOLDOWN_MS = 60_000;
/** Le bot ignore un ordre plus vieux que ça, même livré par erreur. */
export const COMMAND_MAX_AGE_AT_BOT_MS = 5 * 60_000;
/** Si le bot n'est pas revenu 3 minutes après avoir reçu l'ordre, la console le signale. */
export const RESTART_STALLED_MS = 3 * 60_000;
/** Même seuil que la page de statut : plus de signal depuis 70 s = hors ligne. */
export const ONLINE_WINDOW_MS = 70_000;

export type BotCommandStatus = "pending" | "delivered" | "expired";
export type BotCommand = {
  id: string;
  profile: BotProfileId;
  action: typeof RESTART_ACTION;
  status: BotCommandStatus;
  requestedAt: string;
  requestedBy: string | null;
  deliveredAt: string | null;
};

/** Ce que le bot reçoit : le strict nécessaire, rien d'autre. */
export type DeliveredCommand = { id: string; action: typeof RESTART_ACTION; issuedAt: string };

export type RestartPhase = "idle" | "waiting" | "sent" | "restarted" | "stalled" | "expired";

/**
 * Où en est le dernier ordre d'un bot, pour l'affichage.
 * - waiting : déposé, le bot ne l'a pas encore lu (lecture à chaque rapport, 20 s maximum).
 * - sent : le bot l'a reçu et se ferme ; PM2 le relance.
 * - restarted : un nouveau processus a démarré après la livraison.
 * - stalled : livré depuis plus de 3 min et aucun nouveau processus : PM2 n'a pas relancé le bot.
 * - expired : jamais lu dans les 2 minutes (le bot ne communiquait déjà plus).
 */
export function restartPhase(command: BotCommand | null, botStartedAt: string | null, now = Date.now()): RestartPhase {
  if (!command) return "idle";
  const requested = Date.parse(command.requestedAt);
  if (command.status === "expired") return "expired";
  if (command.status === "pending") return now - requested > COMMAND_TTL_MS ? "expired" : "waiting";
  const delivered = command.deliveredAt ? Date.parse(command.deliveredAt) : NaN;
  const started = botStartedAt ? Date.parse(botStartedAt) : NaN;
  if (Number.isFinite(delivered) && Number.isFinite(started) && started > delivered) return "restarted";
  if (Number.isFinite(delivered) && now - delivered > RESTART_STALLED_MS) return "stalled";
  return "sent";
}

/** Anti-spam : refuse un deuxième ordre pour le même bot avant la fin du délai. */
export function restartCooldownLeftMs(lastRequestedAt: string | null, now = Date.now()): number {
  if (!lastRequestedAt) return 0;
  const left = Date.parse(lastRequestedAt) + RESTART_COOLDOWN_MS - now;
  return Number.isFinite(left) && left > 0 ? left : 0;
}

/** Seul le bot lui-même peut être visé, et seul « restart » existe. Aucun texte libre n'est jamais exécuté. */
export function parseRestartRequest(input: unknown): { bot: BotProfileId } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "bot") return null;
  return isBotProfileId(record["bot"]) ? { bot: record["bot"] } : null;
}

export function isRestartableProfile(value: unknown): value is BotProfileId {
  return isBotProfileId(value) && BOT_PROFILE_IDS.includes(value);
}
