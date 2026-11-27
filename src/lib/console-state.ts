// Console du site : met en forme ce que les bots transmettent déjà (statut, événements à codes fixes, activité)
// pour la page /console/. Fonctions pures, testées : aucune donnée sensible, aucun log brut, aucun contenu de message.
import {
  BOT_PROFILES, BOT_PROFILE_IDS, BRIDGED_PREFIX_COMMANDS, DEFAULT_PREFIXES, PREFIX_COMMAND_OWNERS, SLASH_COMMAND_OWNERS,
  type BotProfileId,
} from "./bot-profiles";
import { EVENT_LABELS, runtimeEventCodes, runtimeStatusRowId } from "./bot-status";
import { ONLINE_WINDOW_MS, restartPhase, type BotCommand, type RestartPhase } from "./bot-control";
import { ACTIVITY_STALE_MS, activityTotals, fillActivityDays, type ActivitySnapshot } from "./activity";

type EventCode = (typeof runtimeEventCodes)[number];
const KNOWN_CODES = new Set<string>(runtimeEventCodes);

export type EventCategory = "moderation" | "securite" | "vocal" | "roles" | "systeme" | "economie" | "communaute";
export type Severity = 0 | 1 | 2;

const CRITICAL = new Set<string>([
  "health_critical", "antinuke_triggered", "guild_guard_raid", "owner_shield_blocked", "unhandled_rejection_restart",
  "acl_critical_found", "tier0_kick_detected", "tier0_loop_stopped", "blr_loop_guard", "staff_abuse_alert",
]);
const WARNING = new Set<string>([
  "disconnected", "reconnecting", "gateway_error", "hierarchy_refused", "blr_blocked", "blr_reverted", "tier0_reverted",
  "acl_risk_detected", "alt_suspect", "guild_blocked", "shared_db_down", "slash_commands_over_limit", "logs_hub_incomplete",
  "economy_pending_review", "guardian_review_opened", "guild_guard_kick", "guild_guard_quarantine", "remote_command_ignored",
]);

export function eventSeverity(code: string): Severity {
  if (CRITICAL.has(code)) return 2;
  if (WARNING.has(code) || code.endsWith("_error") || code === "unhandled_rejection") return 1;
  return 0;
}

/** Rangement des codes fixes par famille, pour les filtres de la console. Inconnu = système. */
export function eventCategory(code: string): EventCategory {
  if (/^(antinuke|guild_guard|blr|tier0|owner_shield|hierarchy|acl_|alt_|automod|spam_|blacklist|staff_abuse|guardian|ghost_ping|media_only|night_mode|guild_blocked)/.test(code)) return "securite";
  if (/^(dog_|menotte|lockname|voice|temp_voice|pv_|anti_move|radio|blindtest|tts|waouf)/.test(code)) return "vocal";
  if (/^(sysplus|whitelist_role|adminplus|discord_setup|automation_autorole|staff_supervisor|rankall)/.test(code)) return "roles";
  if (/^(economy|auction|fisc_|investment|investplus|business)/.test(code)) return "economie";
  if (/^(tempban|report|modmail|staff_|warn|sticky|log_)/.test(code)) return "moderation";
  if (/^(ticket|giveaway|event_|trivia|levels|birthdays|reminders|counting|starboard|qotd|motm|drop|seniority|countdown|live_alert|invite_|organization_|webhook_|charter|support_)/.test(code)) return "communaute";
  return "systeme";
}

export type RuntimeRow = {
  id: string;
  connected: boolean;
  last_seen: string;
  last_sync: string | null;
  started_at: string;
  events: unknown;
  guilds: unknown;
};

export type ConsoleEvent = { at: string; bot: BotProfileId; code: EventCode; label: string; category: EventCategory; severity: Severity };

export type ConsoleBot = {
  id: BotProfileId;
  label: string;
  summary: string;
  optional: boolean;
  /** null = slash uniquement. */
  prefix: string | null;
  state: "online" | "offline" | "unknown";
  /** Le processus transmet encore son statut (même si Discord est déconnecté) : il peut lire un ordre. */
  reachable: boolean;
  lastSeen: string | null;
  lastSync: string | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  guilds: { id: string; name: string }[];
  commands: { slash: string[]; prefix: string[] };
  restart: { phase: RestartPhase; requestedAt: string | null; requestedBy: string | null };
};

export type ConsoleActivity = {
  guildId: string;
  guildName: string | null;
  capturedAt: string;
  stale: boolean;
  rankedMembers: number;
  totals: { messages: number; joins: number; leaves: number };
  daily: { day: string; messages: number; joins: number; leaves: number }[];
  top: { displayName: string | null; level: number; xp: number }[];
};

export type ConsoleState = {
  generatedAt: string;
  bots: ConsoleBot[];
  events: ConsoleEvent[];
  activity: ConsoleActivity[];
};

function readEvents(value: unknown): { at: string; code: EventCode }[] {
  if (!Array.isArray(value)) return [];
  const out: { at: string; code: EventCode }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { at, code } = item as { at?: unknown; code?: unknown };
    if (typeof at === "string" && Number.isFinite(Date.parse(at)) && typeof code === "string" && KNOWN_CODES.has(code)) out.push({ at, code: code as EventCode });
  }
  return out;
}

function readGuilds(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((g): g is { id: string; name: string } => !!g && typeof (g as { id?: unknown }).id === "string" && typeof (g as { name?: unknown }).name === "string")
    .map((g) => ({ id: g.id, name: g.name }));
}

export function buildConsoleState(input: { rows: RuntimeRow[]; activity: ActivitySnapshot[]; commands: BotCommand[]; now?: number }): ConsoleState {
  const now = input.now ?? Date.now();
  const iso = (value: string | null) => (value ? new Date(value).toISOString() : null);

  const bots: ConsoleBot[] = BOT_PROFILE_IDS.map((id) => {
    const row = input.rows.find((r) => r.id === runtimeStatusRowId(id === "fwu" ? undefined : id)) ?? null;
    const profile = BOT_PROFILES[id];
    const age = row ? now - Date.parse(row.last_seen) : Infinity;
    const reachable = row !== null && age <= ONLINE_WINDOW_MS;
    const state: ConsoleBot["state"] = !row ? "unknown" : reachable && row.connected ? "online" : "offline";
    const startedAt = row ? iso(row.started_at) : null;
    const started = startedAt ? Date.parse(startedAt) : NaN;
    const command = input.commands.find((c) => c.profile === id) ?? null; // la liste arrive du plus récent au plus ancien
    const slash = [...SLASH_COMMAND_OWNERS[id]];
    const prefix = DEFAULT_PREFIXES[id] === null ? [] : [...PREFIX_COMMAND_OWNERS[id], ...BRIDGED_PREFIX_COMMANDS[id]];
    return {
      id,
      label: profile.label,
      summary: profile.summary,
      optional: profile.optional === true,
      prefix: DEFAULT_PREFIXES[id],
      state,
      reachable,
      lastSeen: row ? iso(row.last_seen) : null,
      lastSync: row ? iso(row.last_sync) : null,
      startedAt,
      uptimeSeconds: state === "online" && Number.isFinite(started) && started <= now ? Math.floor((now - started) / 1000) : null,
      guilds: row ? readGuilds(row.guilds) : [],
      commands: { slash, prefix: [...new Set(prefix)] },
      restart: { phase: restartPhase(command, startedAt, now), requestedAt: command?.requestedAt ?? null, requestedBy: command?.requestedBy ?? null },
    };
  });

  const events: ConsoleEvent[] = [];
  for (const id of BOT_PROFILE_IDS) {
    const row = input.rows.find((r) => r.id === runtimeStatusRowId(id === "fwu" ? undefined : id));
    if (!row) continue;
    for (const e of readEvents(row.events)) {
      // Un horodatage dans le futur (horloge du VPS) est ramené à maintenant : il ne doit pas coller en tête du journal.
      const at = Date.parse(e.at) > now ? new Date(now).toISOString() : e.at;
      events.push({ at, bot: id, code: e.code, label: EVENT_LABELS[e.code], category: eventCategory(e.code), severity: eventSeverity(e.code) });
    }
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const activity: ConsoleActivity[] = input.activity.map((snap) => {
    const lastDay = snap.capturedAt.slice(0, 10);
    const daily = fillActivityDays(snap.daily, lastDay);
    return {
      guildId: snap.guildId,
      guildName: snap.guildName,
      capturedAt: snap.capturedAt,
      stale: now - Date.parse(snap.capturedAt) > ACTIVITY_STALE_MS,
      rankedMembers: snap.rankedMembers,
      totals: activityTotals(daily),
      daily,
      top: snap.topXp.slice(0, 10).map((m) => ({ displayName: m.displayName, level: m.level, xp: m.xp })),
    };
  });

  return { generatedAt: new Date(now).toISOString(), bots, events: events.slice(0, 300), activity };
}
