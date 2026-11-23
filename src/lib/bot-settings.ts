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
  dog?: DogSettings;
  wakeup?: WakeupSettings;
};

export const BOT_MODULE_SETTINGS_KEYS = ["spam", "guildGuard", "moderation", "verification", "tickets", "tempVoice", "automation", "dog", "wakeup"] as const;

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
  },
  automation: { autoRoleIds: [], welcomeDm: false, welcomeDmMessage: "Bienvenue sur **{server}** !" },
  liveAlerts: { enabled: false, channelId: null, animated: true, creators: [] },
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
