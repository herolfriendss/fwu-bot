import { z } from "zod";

export const runtimeEventCodes = [
  "started", "connected", "disconnected", "reconnecting", "sync_ok", "sync_error", "gateway_error",
  "message_error", "voice_error", "interaction_error", "welcome_error", "dog_enforcement_error",
  "dog_nickname_restored", "dog_leashes_restored", "dog_reconcile_error", "dog_voice_returned", "dog_voice_error",
  "sysplus_role_updated", "radio_autostarted", "radio_autostart_error", "spam_timeout_error", "slash_commands_registered", "slash_commands_registration_error",
  "economy_snapshot_ok", "economy_snapshot_error",
  "guild_guard_updated", "guild_guard_raid", "guild_guard_kick", "guild_guard_quarantine", "guild_guard_log", "guild_guard_error", "guild_blocked",
  "temp_voice_created", "temp_voice_deleted", "temp_voice_error",
  "trivia_started", "trivia_solved", "giveaway_created", "giveaway_finished", "giveaway_error",
  "event_created", "event_started", "event_error",
  "ticket_panel", "ticket_opened", "ticket_closed", "ticket_claimed", "ticket_member_added", "ticket_member_removed", "ticket_error",
  "automation_updated", "automation_autorole_applied", "automation_welcome_dm", "automation_message_sent", "automation_schedule_created", "automation_schedule_removed", "automation_error",
] as const;

const runtimeGuildSchema = z.object({
  id: z.string().regex(/^\d{5,25}$/),
  name: z.string().min(1).max(100),
  icon: z.string().nullable(),
}).strict();

export const runtimeReportSchema = z.object({
  connected: z.boolean(),
  startedAt: z.string().datetime(),
  lastSync: z.string().datetime().nullable(),
  events: z.array(z.object({
    at: z.string().datetime(),
    code: z.enum(runtimeEventCodes),
  }).strict()).max(50),
  guilds: z.array(runtimeGuildSchema).max(500).default([]),
}).strict();

export type RuntimeReport = z.infer<typeof runtimeReportSchema>;
export type RuntimeStatus = RuntimeReport & { lastSeen: string };

export const EVENT_LABELS: Record<typeof runtimeEventCodes[number], string> = {
  started: "Processus démarré",
  connected: "Connexion Discord établie",
  disconnected: "Connexion Discord interrompue",
  reconnecting: "Reconnexion à Discord",
  sync_ok: "Réglages synchronisés",
  sync_error: "Échec de synchronisation",
  gateway_error: "Erreur de connexion Discord",
  message_error: "Erreur de traitement d’un message",
  voice_error: "Erreur de commande vocale",
  interaction_error: "Erreur de traitement d’une interaction",
  welcome_error: "Échec du message de bienvenue",
  dog_enforcement_error: "Échec de réapplication du surnom DOG",
  dog_nickname_restored: "Surnom de laisse DOG rétabli",
  dog_leashes_restored: "État DOG restauré après reconnexion",
  dog_reconcile_error: "Échec de restauration DOG",
  dog_voice_returned: "Membre DOG ramené dans le vocal du propriétaire",
  dog_voice_error: "Échec du retour vocal DOG",
  sysplus_role_updated: "Rôle SYS+ mis à jour",
  radio_autostarted: "Radio 24/7 redémarrée",
  radio_autostart_error: "Échec du redémarrage de la radio",
  spam_timeout_error: "Échec du timeout anti-spam",
  slash_commands_registered: "Commandes slash enregistrées",
  slash_commands_registration_error: "Échec de l’enregistrement des commandes slash",
  economy_snapshot_ok: "Soldes PND synchronisés vers le tableau de bord",
  economy_snapshot_error: "Échec de la synchronisation des soldes PND",
  guild_guard_updated: "Réglages GuildGuard mis à jour",
  guild_guard_raid: "Rafale de connexions détectée",
  guild_guard_kick: "Compte récent expulsé par GuildGuard",
  guild_guard_quarantine: "Compte récent placé en quarantaine",
  guild_guard_log: "Arrivée signalée par GuildGuard",
  guild_guard_error: "Erreur GuildGuard",
  guild_blocked: "Serveur hors allowlist quitté",
  temp_voice_created: "Salon vocal temporaire créé",
  temp_voice_deleted: "Salon vocal temporaire supprimé",
  temp_voice_error: "Erreur salon vocal temporaire",
  trivia_started: "Trivia lancée",
  trivia_solved: "Trivia résolue",
  giveaway_created: "Giveaway lancé",
  giveaway_finished: "Giveaway terminé",
  giveaway_error: "Erreur giveaway",
  event_created: "Événement créé",
  event_started: "Événement commencé",
  event_error: "Erreur événement",
  ticket_panel: "Panneau de tickets publié",
  ticket_opened: "Ticket ouvert",
  ticket_closed: "Ticket fermé",
  ticket_claimed: "Ticket pris en charge",
  ticket_member_added: "Membre ajouté à un ticket",
  ticket_member_removed: "Membre retiré d’un ticket",
  ticket_error: "Erreur ticket",
  automation_updated: "Réglages d’automatisation mis à jour",
  automation_autorole_applied: "Rôle automatique attribué",
  automation_welcome_dm: "MP de bienvenue envoyé",
  automation_message_sent: "Message planifié envoyé",
  automation_schedule_created: "Message planifié créé",
  automation_schedule_removed: "Message planifié supprimé",
  automation_error: "Erreur d’automatisation",
};

export function connectionState(status: RuntimeStatus | null, now = Date.now()) {
  if (!status) return "unknown";
  if (now - Date.parse(status.lastSeen) > 70_000 || !status.connected) return "offline";
  return "online";
}

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
