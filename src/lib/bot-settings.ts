// Shared (browser + server + VPS bot) settings for the self-hosted 24/7 bot.
import { prefixCommandSchema, type PrefixCommand } from "./prefix-commands";
import { DEFAULT_VOICE_ACCESS, voiceAccessSchema, type VoiceAccess } from "./voice-access";
export type KeywordRule = { trigger: string; response: string; exact: boolean };
export type BotSettings = {
  sysPlus: { roleId: string | null };
  voiceAccess: VoiceAccess;
  prefixCommands: PrefixCommand[];
  keywords: KeywordRule[];
  filter: { enabled: boolean; words: string[]; deleteMessage: boolean; warn: string };
  spam: { enabled: boolean; maxMessages: number; perSeconds: number; timeoutMinutes: number };
  welcome: { enabled: boolean; channelId: string; message: string };
  ai: { enabled: boolean; instructions: string };
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
