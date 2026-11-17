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
  protectRoleId: string | null;
  staffRoleIds: string[];
  untouchableRoleIds: string[];
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
  moderation: { logChannelId: null, dmOnWarn: true, warnExpiryDays: 90, protectRoleId: null, staffRoleIds: [], untouchableRoleIds: [] },
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
  const recordOf = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const r = recordOf(raw);
  const filter = recordOf(r["filter"]);
  const spam = recordOf(r["spam"]);
  const welcome = recordOf(r["welcome"]);
  const sysPlus = recordOf(r["sysPlus"]);
  const guildGuard = recordOf(r["guildGuard"]);
  const ai = recordOf(r["ai"]);
  const moderation = recordOf(r["moderation"]);
  const verification = recordOf(r["verification"]);
  const tickets = recordOf(r["tickets"]);
  const tempVoice = recordOf(r["tempVoice"]);
  const automation = recordOf(r["automation"]);
  const d = DEFAULT_SETTINGS;
  const keywords = (Array.isArray(r["keywords"]) ? r["keywords"] : [])
    .map((value: unknown) => {
      const keyword = recordOf(value);
      return {
        trigger: str(keyword["trigger"], 100).toLowerCase(),
        response: str(keyword["response"], 2000),
        exact: bool(keyword["exact"], false),
      };
    })
    .filter((keyword: KeywordRule) => keyword["trigger"] && keyword["response"])
    .slice(0, 100);
  const words = (Array.isArray(filter["words"]) ? filter["words"] : [])
    .map((w: unknown) => str(w, 60).toLowerCase())
    .filter(Boolean)
    .slice(0, 300);
  const channelId = str(welcome["channelId"], 25);
  const sysPlusRoleId = str(sysPlus["roleId"], 25);
  const snowflakeId = (value: unknown) => {
    const id = str(value, 25);
    return /^\d{5,25}$/.test(id) ? id : null;
  };
  const snowflakeList = (value: unknown, max: number) => [...new Set(
    (Array.isArray(value) ? value : []).map(snowflakeId).filter((id): id is string => Boolean(id)),
  )].slice(0, max);
  const youngAction = ["log", "kick", "quarantine"].includes(str(guildGuard["youngAccountAction"], 20))
    ? str(guildGuard["youngAccountAction"], 20) as GuildGuardSettings["youngAccountAction"]
    : d.guildGuard["youngAccountAction"];
  return {
    sysPlus: { roleId: /^\d{5,25}$/.test(sysPlusRoleId) ? sysPlusRoleId : null },
    voiceAccess: voiceAccessSchema.safeParse(r["voiceAccess"]).success ? voiceAccessSchema.parse(r["voiceAccess"]) : DEFAULT_VOICE_ACCESS,
    prefixCommands: (Array.isArray(r["prefixCommands"]) ? r["prefixCommands"] : []).flatMap((command: unknown) => {
      const result = prefixCommandSchema.safeParse(command);
      return result.success ? [result.data] : [];
    }),
    keywords,
    filter: { enabled: bool(filter["enabled"], false), words, deleteMessage: bool(filter["deleteMessage"], true), warn: str(filter["warn"], 500) },
    spam: {
      enabled: bool(spam["enabled"], false),
      maxMessages: int(spam["maxMessages"], 2, 30, d.spam["maxMessages"]),
      perSeconds: int(spam["perSeconds"], 1, 60, d.spam["perSeconds"]),
      timeoutMinutes: int(spam["timeoutMinutes"], 1, 1440, d.spam["timeoutMinutes"]),
    },
    welcome: { enabled: bool(welcome["enabled"], false), channelId: /^\d{5,25}$/.test(channelId) ? channelId : "", message: str(welcome["message"], 2000) || d.welcome["message"] },
    ai: { enabled: bool(ai["enabled"], false), instructions: str(ai["instructions"], 2000) || d.ai["instructions"] },
    guildGuard: {
      enabled: bool(guildGuard["enabled"], false),
      minAccountAgeDays: int(guildGuard["minAccountAgeDays"], 0, 365, d.guildGuard["minAccountAgeDays"]),
      youngAccountAction: youngAction,
      quarantineRoleId: snowflakeId(guildGuard["quarantineRoleId"]),
      logChannelId: snowflakeId(guildGuard["logChannelId"]),
      raidJoinThreshold: int(guildGuard["raidJoinThreshold"], 0, 100, d.guildGuard["raidJoinThreshold"]),
      raidWindowSeconds: int(guildGuard["raidWindowSeconds"], 10, 600, d.guildGuard["raidWindowSeconds"]),
      lockdown: bool(guildGuard["lockdown"], false),
    },
    moderation: {
      logChannelId: snowflakeId(moderation["logChannelId"]),
      dmOnWarn: bool(moderation["dmOnWarn"], true),
      warnExpiryDays: int(moderation["warnExpiryDays"], 0, 365, d.moderation["warnExpiryDays"]),
      protectRoleId: snowflakeId(moderation["protectRoleId"]),
      staffRoleIds: snowflakeList(moderation["staffRoleIds"], 30),
      untouchableRoleIds: snowflakeList(moderation["untouchableRoleIds"], 30),
    },
    verification: {
      enabled: bool(verification["enabled"], false),
      roleId: snowflakeId(verification["roleId"]),
      channelId: snowflakeId(verification["channelId"]),
      minAccountAgeDays: int(verification["minAccountAgeDays"], 0, 365, d.verification["minAccountAgeDays"]),
      message: str(verification["message"], 2000) || d.verification["message"],
    },
    tickets: {
      enabled: bool(tickets["enabled"], false),
      categoryId: snowflakeId(tickets["categoryId"]),
      supportRoleId: snowflakeId(tickets["supportRoleId"]),
      logChannelId: snowflakeId(tickets["logChannelId"]),
      maxOpenPerUser: int(tickets["maxOpenPerUser"], 1, 5, d.tickets["maxOpenPerUser"]),
    },
    tempVoice: {
      enabled: bool(tempVoice["enabled"], false),
      hubChannelId: snowflakeId(tempVoice["hubChannelId"]),
      categoryId: snowflakeId(tempVoice["categoryId"]),
      defaultLimit: int(tempVoice["defaultLimit"], 0, 99, d.tempVoice["defaultLimit"]),
      nameTemplate: str(tempVoice["nameTemplate"], 80) || d.tempVoice["nameTemplate"],
    },
    automation: {
      autoRoleIds: snowflakeList(automation["autoRoleIds"], 10),
      welcomeDm: bool(automation["welcomeDm"], false),
      welcomeDmMessage: str(automation["welcomeDmMessage"], 2000) || d.automation["welcomeDmMessage"],
    },
  };
}

/** Sanitizes role settings in the context of their guild, excluding @everyone. */
export function sanitizeSettingsForGuild(input: unknown, guildId: string): BotSettings {
  const settings = sanitizeSettings(input);
  return {
    ...settings,
    sysPlus: {
      roleId: settings.sysPlus.roleId === guildId ? null : settings.sysPlus.roleId,
    },
    guildGuard: {
      ...settings.guildGuard,
      quarantineRoleId: settings.guildGuard.quarantineRoleId === guildId ? null : settings.guildGuard.quarantineRoleId,
    },
    moderation: {
      ...settings.moderation,
      protectRoleId: settings.moderation.protectRoleId === guildId ? null : settings.moderation.protectRoleId,
      staffRoleIds: settings.moderation.staffRoleIds.filter((id) => id !== guildId),
      untouchableRoleIds: settings.moderation.untouchableRoleIds.filter((id) => id !== guildId),
    },
    verification: {
      ...settings.verification,
      roleId: settings.verification.roleId === guildId ? null : settings.verification.roleId,
    },
    tickets: {
      ...settings.tickets,
      supportRoleId: settings.tickets.supportRoleId === guildId ? null : settings.tickets.supportRoleId,
    },
    automation: {
      ...settings.automation,
      autoRoleIds: settings.automation.autoRoleIds.filter((id) => id !== guildId),
    },
  };
}

/** Returns the keyword reply for a message, or null. Exact = whole message; otherwise whole word/phrase match. */
export function matchKeyword(rules: KeywordRule[], content: string): string | null {
  const text = content.toLowerCase().trim();
  for (const r of rules) {
    if (r["exact"] ? text === r["trigger"] : new RegExp(`(^|[^\\p{L}\\p{N}])${escape(r["trigger"])}($|[^\\p{L}\\p{N}])`, "u").test(text)) return r["response"];
  }
  return null;
}

export function containsBannedWord(words: string[], content: string): boolean {
  const text = content.toLowerCase();
  return words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, "u").test(text));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
