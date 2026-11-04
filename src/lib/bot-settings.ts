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
export type BotSettings = {
  sysPlus: { roleId: string | null };
  voiceAccess: VoiceAccess;
  prefixCommands: PrefixCommand[];
  keywords: KeywordRule[];
  filter: { enabled: boolean; words: string[]; deleteMessage: boolean; warn: string };
  spam: { enabled: boolean; maxMessages: number; perSeconds: number; timeoutMinutes: number };
  welcome: { enabled: boolean; channelId: string; message: string };
  ai: { enabled: boolean; instructions: string };
  guildGuard: GuildGuardSettings;
  moderation: ModerationSettings;
  verification: VerificationSettings;
  tickets: TicketSettings;
  tempVoice: TempVoiceSettings;
  automation: AutomationSettings;
};

export const DEFAULT_SETTINGS: BotSettings = {
  sysPlus: { roleId: null },
  voiceAccess: DEFAULT_VOICE_ACCESS,
  prefixCommands: [],
  keywords: [],
  filter: { enabled: false, words: [], deleteMessage: true, warn: "{user}, ce message n’est pas autorisé ici." },
  spam: { enabled: false, maxMessages: 5, perSeconds: 5, timeoutMinutes: 5 },
  welcome: { enabled: false, channelId: "", message: "Bienvenue {user} sur **{server}** ! 👋" },
  ai: { enabled: false, instructions: "Tu es un assistant sympathique et concis qui répond en français." },
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
    message: "Clique sur le bouton ci-dessous pour accéder au serveur.",
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
};

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function sanitizeSettings(raw: unknown): BotSettings {
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
  return {
    sysPlus: { roleId: /^\d{5,25}$/.test(sysPlusRoleId) ? sysPlusRoleId : null },
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
    },
    welcome: { enabled: bool(r.welcome?.enabled, false), channelId: /^\d{5,25}$/.test(channelId) ? channelId : "", message: str(r.welcome?.message, 2000) || d.welcome.message },
    ai: { enabled: bool(r.ai?.enabled, false), instructions: str(r.ai?.instructions, 2000) || d.ai.instructions },
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
