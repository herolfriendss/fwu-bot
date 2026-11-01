import { z } from "zod";

export const runtimeEventCodes = [
  "started", "connected", "disconnected", "reconnecting", "sync_ok", "sync_error", "gateway_error",
  "message_error", "voice_error", "interaction_error", "welcome_error", "dog_enforcement_error",
  "dog_nickname_restored", "dog_leashes_restored", "dog_reconcile_error", "dog_voice_returned", "dog_voice_error",
  "sysplus_role_updated", "radio_autostarted", "radio_autostart_error", "spam_timeout_error",
] as const;
export const runtimeReportSchema = z.object({
  connected: z.boolean(),
  startedAt: z.string().datetime(),
  lastSync: z.string().datetime().nullable(),
  events: z.array(z.object({ at: z.string().datetime(), code: z.enum(runtimeEventCodes) }).strict()).max(50),
}).strict();
export type RuntimeReport = z.infer<typeof runtimeReportSchema>;
export type RuntimeStatus = RuntimeReport & { lastSeen: string };
export const EVENT_LABELS: Record<typeof runtimeEventCodes[number], string> = {
  started: "Processus démarré", connected: "Connexion Discord établie", disconnected: "Connexion Discord interrompue",
  reconnecting: "Reconnexion à Discord", sync_ok: "Réglages synchronisés", sync_error: "Échec de synchronisation",
  gateway_error: "Erreur de connexion Discord", message_error: "Erreur de traitement d’un message",
  voice_error: "Erreur de commande vocale", interaction_error: "Erreur de traitement d’une interaction",
  welcome_error: "Échec du message de bienvenue", dog_enforcement_error: "Échec de réapplication du surnom DOG",
  dog_nickname_restored: "Surnom de laisse DOG rétabli", dog_leashes_restored: "État DOG restauré après reconnexion",
  dog_reconcile_error: "Échec de restauration DOG", dog_voice_returned: "Membre DOG ramené dans le vocal du propriétaire",
  dog_voice_error: "Échec du retour vocal DOG", sysplus_role_updated: "Rôle SYS+ mis à jour",
  radio_autostarted: "Radio 24/7 redémarrée", radio_autostart_error: "Échec du redémarrage de la radio",
  spam_timeout_error: "Échec du timeout anti-spam",
};
export function connectionState(status: RuntimeStatus | null, now = Date.now()) {
  if (!status) return "unknown";
  if (now - Date.parse(status.lastSeen) > 70_000 || !status.connected) return "offline";
  return "online";
}

// The uptime belongs to the Oracle process, never to the website runtime.
export function slashRuntimeStatus(status: RuntimeStatus | null, now = Date.now()) {
  const state = connectionState(status, now);
  const started = status ? Date.parse(status.startedAt) : NaN;
  const uptimeSeconds = status && state === "online" && Number.isFinite(started) && started <= now
    ? Math.floor((now - started) / 1000)
    : null;
  return { state, uptimeSeconds };
}

export function formatRuntimeDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 86400)} j ${Math.floor(total / 3600) % 24} h ${Math.floor(total / 60) % 60} min ${total % 60} s`;
}
