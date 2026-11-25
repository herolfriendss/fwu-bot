// Shared (browser + server + VPS bot) settings for the self-hosted 24/7 bot.
import { prefixCommandSchema, type PrefixCommand } from "./prefix-commands";
import { DEFAULT_VOICE_ACCESS, voiceAccessSchema, type VoiceAccess } from "./voice-access";
export type KeywordRule = { trigger: string; response: string; exact: boolean };
export type GuildGuardSettings = {
  enabled: boolean;
  minAccountAgeDays: number;
  youngAccountAction: "log" | "kick" | "quarantine";
  quarantineRoleId: string | null;
  logChannelId: string | null;
  raidJoinThreshold: number;
  raidWindowSeconds: number;
  lockdown: boolean;
};
export type ModerationSettings = {
  logChannelId: string | null;
  dmOnWarn: boolean;
  warnExpiryDays: number;
};
export type VerificationSettings = {
  enabled: boolean;
  roleId: string | null;
  channelId: string | null;
  minAccountAgeDays: number;
  message: string;
};
export type TicketSettings = {
  enabled: boolean;
  categoryId: string | null;
  supportRoleId: string | null;
  logChannelId: string | null;
  maxOpenPerUser: number;
};
export type TempVoiceSettings = {
  enabled: boolean;
  hubChannelId: string | null;
  categoryId: string | null;
  defaultLimit: number;
  nameTemplate: string;
  /** Grace period before an empty temporary channel is deleted (0–300 s). */
  emptyDeleteSeconds: number;
};
export type AutomationSettings = {
  autoRoleIds: string[];
  welcomeDm: boolean;
  welcomeDmMessage: string;
};
export type LiveAlertCreator = {
  id: string;
  platform: "youtube" | "tiktok" | "twitch" | "other";
  displayName: string;
  feedUrl: string;
};
export type LiveAlertsSettings = {
  enabled: boolean;
  channelId: string | null;
  animated: boolean;
  /** Role mentioned in each LIVE announcement (null = no ping). */
  mentionRoleId: string | null;
  creators: LiveAlertCreator[];
};
export type DogSettings = { maxActiveLeashes: number };
/** WAKEUP exclusions: configured channel ids are preferred, name matching is only a fallback in the bot. */
export type WakeupSettings = { ownerChannelId: string | null; waitingChannelId: string | null; excludedChannelIds: string[] };

export type BotSettings = {
  logs: { channelId: string | null };
  sysPlus: { roleId: string | null; whitelistRoleId: string | null; intelligenceEnabled: boolean; intelligenceChannelId: string | null };
  adminPlus: { roleId: string | null };
  voiceAccess: VoiceAccess;
  prefixCommands: PrefixCommand[];
  keywords: KeywordRule[];
  filter: { enabled: boolean; words: string[]; deleteMessage: boolean; warn: string };
  spam: { enabled: boolean; maxMessages: number; perSeconds: number; timeoutMinutes: number; maxMentions: number };
  welcome: { enabled: boolean; channelId: string; message: string };
  ai: { enabled: boolean; memoryEnabled: boolean; instructions: string };
  guildGuard: GuildGuardSettings;
  moderation: ModerationSettings;
  verification: VerificationSettings;
  tickets: TicketSettings;
  tempVoice: TempVoiceSettings;
  automation: AutomationSettings;
  liveAlerts: LiveAlertsSettings;
  /** Public showcase page of the server on the website. Off by default; the leaderboard shows member names, so it is a separate opt-in. */
  publicPage: { enabled: boolean; showLeaderboard: boolean };
  dog?: DogSettings;
  wakeup?: WakeupSettings;
};

export const BOT_MODULE_SETTINGS_KEYS = ["spam", "guildGuard", "moderation", "verification", "tickets", "tempVoice", "automation", "dog", "wakeup", "liveAlerts"] as const;

// Per-guild DOG leash limit. Same bounds as bot/dog-policy.js (kept in sync by tests).
export const DOG_LEASH_LIMIT = Object.freeze({ min: 1, max: 10, default: 3 });

export const DEFAULT_SETTINGS: BotSettings = {
  logs: { channelId: null },
  sysPlus: { roleId: null, whitelistRoleId: null, intelligenceEnabled: false, intelligenceChannelId: null },
  adminPlus: { roleId: null },
  voiceAccess: DEFAULT_VOICE_ACCESS,
  prefixCommands: [],
  keywords: [],
  filter: { enabled: false, words: [], deleteMessage: true, warn: "{user}, ce message n’est pas autorisé ici." },
  spam: { enabled: false, maxMessages: 5, perSeconds: 5, timeoutMinutes: 5, maxMentions: 5 },
  welcome: { enabled: false, channelId: "", message: "Bienvenue {user} sur **{server}** ! 👋" },
  ai: { enabled: false, memoryEnabled: false, instructions: "Tu es un assistant sympathique et concis qui répond en français." },
  guildGuard: {
    enabled: false,
    minAccountAgeDays: 7,
    youngAccountAction: "log",
    quarantineRoleId: null,
    logChannelId: null,
    raidJoinThreshold: 10,
    raidWindowSeconds: 60,
    lockdown: false,
  },
  moderation: { logChannelId: null, dmOnWarn: true, warnExpiryDays: 90 },
  verification: {
    enabled: false,
    roleId: null,
    channelId: null,
    minAccountAgeDays: 7,
    message: "Résous le petit calcul pour confirmer que tu es humain.",
  },
  tickets: { enabled: false, categoryId: null, supportRoleId: null, logChannelId: null, maxOpenPerUser: 1 },
  tempVoice: {
    enabled: false,
    hubChannelId: null,
    categoryId: null,
    defaultLimit: 0,
    nameTemplate: "Salon de {user}",
    emptyDeleteSeconds: 0,
  },
  automation: { autoRoleIds: [], welcomeDm: false, welcomeDmMessage: "Bienvenue sur **{server}** !" },
  liveAlerts: { enabled: false, channelId: null, animated: true, mentionRoleId: null, creators: [] },
  publicPage: { enabled: false, showLeaderboard: false },
};

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

function sanitizeCoreSettings(raw: unknown): BotSettings {
  const r = (raw ?? {}) as Partial<Record<keyof BotSettings, any>>;
  const d = DEFAULT_SETTINGS;
  const keywords = (Array.isArray(r.keywords) ? r.keywords : [])
    .map((k: any) => ({ trigger: str(k?.trigger, 100).toLowerCase(), response: str(k?.response, 2000), exact: bool(k?.exact, false) }))
    .filter((k: KeywordRule) => k.trigger && k.response)
    .slice(0, 100);
  const words = (Array.isArray(r.filter?.words) ? r.filter.words : [])
    .map((w: unknown) => str(w, 60).toLowerCase())
    .filter(Boolean)
    .slice(0, 300);
  const channelId = str(r.welcome?.channelId, 25);
  const sysPlusRoleId = str(r.sysPlus?.roleId, 25);
  const whitelistRoleId = str(r.sysPlus?.whitelistRoleId, 25);
  const snowflakeId = (value: unknown) => {
    const id = str(value, 25);
    return /^\d{5,25}$/.test(id) ? id : null;
  };
  const snowflakeList = (value: unknown, max: number) => [...new Set(
    (Array.isArray(value) ? value : []).map(snowflakeId).filter((id): id is string => Boolean(id)),
  )].slice(0, max);
  const youngAction = ["log", "kick", "quarantine"].includes(str(r.guildGuard?.youngAccountAction, 20))
    ? str(r.guildGuard?.youngAccountAction, 20) as GuildGuardSettings["youngAccountAction"]
    : d.guildGuard.youngAccountAction;
  const adminPlusRoleId = str(r.adminPlus?.roleId, 25);
  return {
    logs: { channelId: snowflakeId(r.logs?.channelId) },
    sysPlus: {
      roleId: /^\d{5,25}$/.test(sysPlusRoleId) ? sysPlusRoleId : null,
      whitelistRoleId: /^\d{5,25}$/.test(whitelistRoleId) ? whitelistRoleId : null,
      intelligenceEnabled: bool(r.sysPlus?.intelligenceEnabled, false),
      intelligenceChannelId: snowflakeId(r.sysPlus?.intelligenceChannelId),
    },
    adminPlus: { roleId: /^\d{5,25}$/.test(adminPlusRoleId) ? adminPlusRoleId : null },
    voiceAccess: voiceAccessSchema.safeParse(r.voiceAccess).success ? voiceAccessSchema.parse(r.voiceAccess) : DEFAULT_VOICE_ACCESS,
    prefixCommands: (Array.isArray(r.prefixCommands) ? r.prefixCommands : []).flatMap((command: unknown) => {
      const result = prefixCommandSchema.safeParse(command);
      return result.success ? [result.data] : [];
    }),
    keywords,
    filter: { enabled: bool(r.filter?.enabled, false), words, deleteMessage: bool(r.filter?.deleteMessage, true), warn: str(r.filter?.warn, 500) },
    spam: {
      enabled: bool(r.spam?.enabled, false),
      maxMessages: int(r.spam?.maxMessages, 2, 30, d.spam.maxMessages),
      perSeconds: int(r.spam?.perSeconds, 1, 60, d.spam.perSeconds),
      timeoutMinutes: int(r.spam?.timeoutMinutes, 1, 1440, d.spam.timeoutMinutes),
      maxMentions: int(r.spam?.maxMentions, 2, 20, d.spam.maxMentions),
    },
    welcome: { enabled: bool(r.welcome?.enabled, false), channelId: /^\d{5,25}$/.test(channelId) ? channelId : "", message: str(r.welcome?.message, 2000) || d.welcome.message },
    ai: { enabled: bool(r.ai?.enabled, false), memoryEnabled: bool(r.ai?.memoryEnabled, false), instructions: str(r.ai?.instructions, 2000) || d.ai.instructions },
    guildGuard: {
      enabled: bool(r.guildGuard?.enabled, false),
      minAccountAgeDays: int(r.guildGuard?.minAccountAgeDays, 0, 365, d.guildGuard.minAccountAgeDays),
      youngAccountAction: youngAction,
      quarantineRoleId: snowflakeId(r.guildGuard?.quarantineRoleId),
      logChannelId: snowflakeId(r.guildGuard?.logChannelId),
      raidJoinThreshold: int(r.guildGuard?.raidJoinThreshold, 0, 100, d.guildGuard.raidJoinThreshold),
      raidWindowSeconds: int(r.guildGuard?.raidWindowSeconds, 10, 600, d.guildGuard.raidWindowSeconds),
      lockdown: bool(r.guildGuard?.lockdown, false),
    },
    moderation: {
      logChannelId: snowflakeId(r.moderation?.logChannelId),
      dmOnWarn: bool(r.moderation?.dmOnWarn, true),
      warnExpiryDays: int(r.moderation?.warnExpiryDays, 0, 365, d.moderation.warnExpiryDays),
    },
    verification: {
      enabled: bool(r.verification?.enabled, false),
      roleId: snowflakeId(r.verification?.roleId),
      channelId: snowflakeId(r.verification?.channelId),
      minAccountAgeDays: int(r.verification?.minAccountAgeDays, 0, 365, d.verification.minAccountAgeDays),
      message: str(r.verification?.message, 2000) || d.verification.message,
    },
    tickets: {
      enabled: bool(r.tickets?.enabled, false),
      categoryId: snowflakeId(r.tickets?.categoryId),
      supportRoleId: snowflakeId(r.tickets?.supportRoleId),
      logChannelId: snowflakeId(r.tickets?.logChannelId),
      maxOpenPerUser: int(r.tickets?.maxOpenPerUser, 1, 5, d.tickets.maxOpenPerUser),
    },
    tempVoice: {
      enabled: bool(r.tempVoice?.enabled, false),
      hubChannelId: snowflakeId(r.tempVoice?.hubChannelId),
      categoryId: snowflakeId(r.tempVoice?.categoryId),
      defaultLimit: int(r.tempVoice?.defaultLimit, 0, 99, d.tempVoice.defaultLimit),
      nameTemplate: str(r.tempVoice?.nameTemplate, 80) || d.tempVoice.nameTemplate,
      emptyDeleteSeconds: int(r.tempVoice?.emptyDeleteSeconds, 0, 300, d.tempVoice.emptyDeleteSeconds),
    },
    automation: {
      autoRoleIds: snowflakeList(r.automation?.autoRoleIds, 10),
      welcomeDm: bool(r.automation?.welcomeDm, false),
      welcomeDmMessage: str(r.automation?.welcomeDmMessage, 2000) || d.automation.welcomeDmMessage,
    },
    liveAlerts: {
      enabled: bool(r.liveAlerts?.enabled, false),
      channelId: snowflakeId(r.liveAlerts?.channelId),
      animated: bool(r.liveAlerts?.animated, true),
      mentionRoleId: snowflakeId(r.liveAlerts?.mentionRoleId),
      creators: (Array.isArray(r.liveAlerts?.creators) ? r.liveAlerts.creators : []).slice(0, 30).flatMap((c: any, index: number) => {
        const platform = ["youtube", "tiktok", "twitch", "other"].includes(str(c?.platform, 20)) ? str(c.platform, 20) as LiveAlertCreator["platform"] : null;
        const displayName = str(c?.displayName, 80);
        const feedUrl = str(c?.feedUrl, 1000);
        try {
          const url = new URL(feedUrl);
          if (!platform || !displayName || url.protocol !== "https:" || !url.hostname || !feedUrl) return [];
        } catch { return []; }
        return [{ id: str(c?.id, 40) || `creator-${index}`, platform, displayName, feedUrl }];
      }),
    },
    publicPage: { enabled: bool(r.publicPage?.enabled, false), showLeaderboard: bool(r.publicPage?.showLeaderboard, false) },
  };
}

/** Strict integer within the configured bounds, otherwise the historical default. */
export function sanitizeDogSettings(value: unknown): DogSettings {
  const raw = (value ?? {}) as { maxActiveLeashes?: unknown };
  const n = raw.maxActiveLeashes;
  const valid = Number.isInteger(n) && (n as number) >= DOG_LEASH_LIMIT.min && (n as number) <= DOG_LEASH_LIMIT.max;
  return { maxActiveLeashes: valid ? (n as number) : DOG_LEASH_LIMIT.default };
}

/** Valid Discord ids only; at most 20 excluded channels. */
export function sanitizeWakeupSettings(value: unknown): WakeupSettings {
  const raw = (value ?? {}) as { ownerChannelId?: unknown; waitingChannelId?: unknown; excludedChannelIds?: unknown };
  const id = (v: unknown) => (typeof v === "string" && /^\d{5,25}$/.test(v.trim()) ? v.trim() : null);
  return {
    ownerChannelId: id(raw.ownerChannelId),
    waitingChannelId: id(raw.waitingChannelId),
    excludedChannelIds: [...new Set((Array.isArray(raw.excludedChannelIds) ? raw.excludedChannelIds : []).map(id).filter((v): v is string => Boolean(v)))].slice(0, 20),
  };
}

export function sanitizeSettings(raw: unknown): BotSettings {
  const base = sanitizeCoreSettings(raw);
  const r = (raw ?? {}) as { dog?: unknown; wakeup?: unknown };
  // The dog and wakeup keys are only present when the input carries them, so a save that does not
  // mention them never rewrites a configured value (see mergeSettingsForWrite).
  return {
    ...base,
    ...(r.dog === undefined ? {} : { dog: sanitizeDogSettings(r.dog) }),
    ...(r.wakeup === undefined ? {} : { wakeup: sanitizeWakeupSettings(r.wakeup) }),
  };
}

/**
 * Merge applied before persisting. Server-owned fields are kept from the latest
 * stored settings; the DOG limit is kept too when the incoming save does not carry it.
 */
export function mergeSettingsForWrite(settings: BotSettings, latest: BotSettings, updateCommands: boolean): BotSettings {
  return {
    ...settings,
    voiceAccess: latest.voiceAccess,
    prefixCommands: updateCommands ? settings.prefixCommands : latest.prefixCommands,
    ...(settings.dog === undefined && latest.dog !== undefined ? { dog: latest.dog } : {}),
    ...(settings.wakeup === undefined && latest.wakeup !== undefined ? { wakeup: latest.wakeup } : {}),
  };
}

/** Returns the keyword reply for a message, or null. Exact = whole message; otherwise whole word/phrase match. */
export function matchKeyword(rules: KeywordRule[], content: string): string | null {
  const text = content.toLowerCase().trim();
  for (const r of rules) {
    if (r.exact ? text === r.trigger : new RegExp(`(^|[^\\p{L}\\p{N}])${escape(r.trigger)}($|[^\\p{L}\\p{N}])`, "u").test(text)) return r.response;
  }
  return null;
}

export function containsBannedWord(words: string[], content: string): boolean {
  const text = content.toLowerCase();
  return words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, "u").test(text));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sections the dashboard edits. A dashboard save sends only the sections that changed,
 * so a module switched from Discord (/setup, bot-sync) in the meantime is never undone
 * by a tab that stayed open. voiceAccess and prefixCommands have their own functions; SYS+,
 * WHITELIST and ADMIN+ roles are changed only from Discord (owner commands, audited), so they
 * are deliberately absent.
 */
export const DASHBOARD_SECTION_KEYS = [
  "logs", "keywords", "filter", "spam", "welcome", "ai",
  "guildGuard", "moderation", "verification", "tickets", "tempVoice", "automation", "liveAlerts", "dog", "wakeup", "publicPage",
] as const;
export type DashboardSectionKey = (typeof DASHBOARD_SECTION_KEYS)[number];
export type DashboardSectionPatch = Partial<Pick<BotSettings, DashboardSectionKey>>;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sections of `edited` that differ from the settings the page loaded. */
export function changedSections(edited: BotSettings, loaded: BotSettings, keys: readonly DashboardSectionKey[] = DASHBOARD_SECTION_KEYS): DashboardSectionPatch {
  const patch: Record<string, unknown> = {};
  for (const key of keys) if (!sameValue(edited[key], loaded[key])) patch[key] = edited[key];
  return patch as DashboardSectionPatch;
}

/** Applies only the dashboard sections present in `patch` on top of the latest stored settings. */
export function applySectionPatch(latest: BotSettings, patch: unknown): BotSettings {
  const source = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...latest };
  for (const key of DASHBOARD_SECTION_KEYS) if (Object.hasOwn(source, key)) next[key] = source[key];
  return sanitizeSettings(next);
}

/**
 * Optimistic check: a section may be written only if its stored value still equals the value
 * the editor started from (`base`). Returns the conflicting section keys (empty = safe to write).
 */
export function sectionConflicts(latest: BotSettings, patch: unknown, base: unknown): DashboardSectionKey[] {
  const changes = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const origin = (base && typeof base === "object" ? base : {}) as Record<string, unknown>;
  return DASHBOARD_SECTION_KEYS.filter((key) => {
    if (!Object.hasOwn(changes, key)) return false;
    if (!Object.hasOwn(origin, key)) return true;
    const startedFrom = sanitizeSettings({ ...latest, [key]: origin[key] })[key];
    return !sameValue(startedFrom, latest[key]);
  });
}

export const SECTION_LABELS: Record<DashboardSectionKey, string> = {
  logs: "Journal centralisé",
  keywords: "Mots-clés",
  filter: "Filtre anti-insultes",
  spam: "Anti-spam et mentions",
  welcome: "Message de bienvenue",
  ai: "Assistant IA",
  guildGuard: "Sécurité anti-raid",
  moderation: "Modération",
  verification: "Vérification des membres",
  tickets: "Tickets communautaires",
  tempVoice: "Salons vocaux temporaires",
  automation: "Automatisations de bienvenue",
  liveAlerts: "Alertes de démarrage LIVE",
  dog: "DOG — laisses par SYS+",
  wakeup: "WAKEUP",
  publicPage: "Page publique",
};

export type BotModuleKey = (typeof BOT_MODULE_SETTINGS_KEYS)[number];

/**
 * Field-level write of one module (used by /setup through bot-sync). Applies only `changes` on
 * top of the stored module and reports the fields whose stored value no longer equals `expected`
 * (the value the editor started from). Nothing must be written when conflicts is non-empty.
 */
export function applyModuleChanges(current: BotSettings, module: BotModuleKey, changes: unknown, expected: unknown): { conflicts: string[]; next: BotSettings } {
  const own = (v: unknown) => Object.fromEntries(
    Object.entries(v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})
      .filter(([key]) => key !== "__proto__" && key !== "constructor" && key !== "prototype"),
  );
  const stored = own(current[module]);
  const wanted = own(expected);
  const conflicts = Object.keys(wanted).filter((key) => !sameValue(stored[key], wanted[key]));
  const next = sanitizeSettings({ ...current, [module]: { ...stored, ...own(changes) } });
  return { conflicts, next };
}
