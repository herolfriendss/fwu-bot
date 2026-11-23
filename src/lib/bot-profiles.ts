// FWU multi-bot ownership map, shared by the dashboard and every bot process.
// Decided by the owner on 2026-11-23: FWU keeps the historical application and
// token, and four specialised applications take over one domain each.
// Plain, erasable TypeScript only: the Oracle bot imports this file directly.

export type BotProfileId = "fwu" | "guard" | "fdpdlavoc" | "suckme" | "fisc";

export type BotProfile = {
  id: BotProfileId;
  label: string;
  /** Environment variable holding this application's token. */
  tokenEnv: string;
  /** Optional per-bot guild allowlist (falls back to V4_ALLOWED_GUILD_IDS). */
  guildAllowlistEnv: string;
  summary: string;
};

export const BOT_PROFILES: Record<BotProfileId, BotProfile> = {
  fwu: {
    id: "fwu",
    label: "FWU",
    tokenEnv: "DISCORD_TOKEN",
    guildAllowlistEnv: "V4_ALLOWED_GUILD_IDS",
    summary: "Événements et logs, bannissements, tickets, social, jeux, RESUME",
  },
  guard: {
    id: "guard",
    label: "GUARD",
    tokenEnv: "PND_GUARD_TOKEN",
    guildAllowlistEnv: "PND_GUARD_GUILD_IDS",
    summary: "Administration et protection : GuildGuard, modération, vérification, anti-spam",
  },
  fdpdlavoc: {
    id: "fdpdlavoc",
    label: "FDPDLAVOC",
    tokenEnv: "PND_FDPDLAVOC_TOKEN",
    guildAllowlistEnv: "PND_FDPDLAVOC_GUILD_IDS",
    summary: "Musique, radio, vocaux temporaires et accès vocaux",
  },
  suckme: {
    id: "suckme",
    label: "SUCK ME",
    tokenEnv: "PND_SUCKME_TOKEN",
    guildAllowlistEnv: "PND_SUCKME_GUILD_IDS",
    summary: "SYS+ : rôles, rankall, DOG, MENOTTE, WAKEUP, LOCKNAME, Anti-Move, automatisations",
  },
  fisc: {
    id: "fisc",
    label: "LE FISC",
    tokenEnv: "PND_FISC_TOKEN",
    guildAllowlistEnv: "PND_FISC_GUILD_IDS",
    summary: "Économie : solde, banque, boutique, marché, casino, entreprises, investissements",
  },
};

export const BOT_PROFILE_IDS = Object.keys(BOT_PROFILES) as BotProfileId[];

/** Registered on every application: each bot answers for itself. */
export const SHARED_SLASH_COMMANDS: readonly string[] = ["aide", "status"];

/** Explicit slash ownership (never derived from help categories, which change). */
export const SLASH_COMMAND_OWNERS: Record<BotProfileId, readonly string[]> = {
  fwu: [
    "ia", "ticket", "candidature", "ban", "sondage",
    "profil", "bio", "rep", "toprep", "color", "cards", "card", "pack", "trade",
    "academy", "award", "story", "radar", "wrapped",
    "dice", "coinflip", "trivia", "giveaway", "event", "pndevent",
    "afk", "blacklist",
  ],
  guard: [
    "guildguard", "warn", "warnings", "mute", "unmute", "kick", "purge", "slowmode",
    "lock", "unlock", "verify", "nettoyer",
  ],
  fdpdlavoc: [
    "access", "unaccess", "pv", "voc",
    "play", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume", "loop",
    "shuffle", "clearqueue", "remove", "join", "leave", "musicpanel", "radio",
  ],
  suckme: [
    "sysp", "panel", "setup", "knowledge", "rank", "rankall", "removerole", "rolepanel",
    "staffhistory", "vocalpresence", "lockname", "webhook", "automation",
    "anti-moove", "wakeup", "dog", "undog", "doginfo", "wouaf", "menotte", "unmenotte", "menotteinfo",
    "dmall",
  ],
  fisc: [
    "balance", "daily", "work", "job", "bank", "history", "rob", "lottery", "pay", "leaderboard",
    "inventory", "shop", "buy", "pnd", "roulette", "blackjack", "business", "invest", "casino",
  ],
};

/** Prefix ("=") commands: the first word decides which bot answers. */
export const PREFIX_COMMAND_OWNERS: Record<BotProfileId, readonly string[]> = {
  fwu: [
    "ticket", "candidature", "candidatures", "ia", "pndia",
    "profil", "profile", "bio", "color", "couleur", "rep", "rephistorique", "rephistory", "toprep",
    "card", "cards", "pack", "trade", "trades",
    "dice", "coinflip", "trivia", "giveaway", "event", "pndevent",
    "academy", "award", "story", "radar", "wrapped", "afk", "blacklist",
  ],
  guard: ["guardian-review", "verification"],
  fdpdlavoc: [
    "pv", "unpv", "access", "unaccess", "panel", "demandevocal",
    "play", "p", "pause", "resume", "skip", "stop", "queue", "nowplaying", "np", "volume", "vol",
    "loop", "shuffle", "clearqueue", "remove", "join", "leave", "musicpanel", "radio",
  ],
  suckme: [
    "sysp", "rank", "addrole", "removerole", "rankall", "rolepanel", "staffhistory", "vocalpresence",
    "lockname", "unlockname", "locknamelist", "automation", "autorule", "knowledge",
    "dog", "undog", "doginfo", "doglist", "menotte", "unmenotte", "menotteinfo", "wakeup",
    "anti-moove", "anti-move", "wouaf", "waouf", "dmall",
  ],
  fisc: [
    "balance", "solde", "daily", "work", "job", "mission", "bank", "history", "rob", "lottery", "pay",
    "leaderboard", "inventory", "shop", "buy", "market", "auction", "pnd", "pnd-history", "pnd-audit",
    "pnd-add", "pnd-remove", "roulette", "blackjack", "casino", "business", "invest",
  ],
};

function invert(map: Record<BotProfileId, readonly string[]>): Map<string, BotProfileId> {
  const owners = new Map<string, BotProfileId>();
  for (const profile of BOT_PROFILE_IDS) {
    for (const name of map[profile]) {
      if (owners.has(name)) throw new Error(`Commande « ${name} » attribuée à deux bots.`);
      owners.set(name, profile);
    }
  }
  return owners;
}

const slashOwners = invert(SLASH_COMMAND_OWNERS);
const prefixOwners = invert(PREFIX_COMMAND_OWNERS);

export function isBotProfileId(value: unknown): value is BotProfileId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BOT_PROFILES, value);
}

/** Owner of a slash command; null for shared commands and unknown (dashboard) commands. */
export function slashCommandOwner(name: string): BotProfileId | null {
  return slashOwners.get(String(name ?? "")) ?? null;
}

/** Owner of a prefix command line ("=play ..."); null when it is not a built-in command. */
export function prefixCommandOwner(content: string): BotProfileId | null {
  const match = /^=([a-z][a-z0-9-]{0,30})(?=$|\s)/i.exec(String(content ?? "").trim());
  return match ? prefixOwners.get((match[1] ?? "").toLowerCase()) ?? null : null;
}

/** Parse "guard,fisc" into a validated, de-duplicated list (FWU itself is never delegated). */
export function parseDelegatedProfiles(value: unknown): BotProfileId[] {
  const out: BotProfileId[] = [];
  for (const raw of String(value ?? "").split(/[\s,]+/)) {
    const id = raw.trim().toLowerCase();
    if (!id) continue;
    if (!isBotProfileId(id) || id === "fwu") throw new Error(`Profil délégué inconnu : ${raw}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Names to register on one application. FWU keeps every command whose domain
 * has not been delegated yet; a dedicated bot registers only its own domain.
 */
export function slashCommandNamesForProfile(profile: BotProfileId, delegated: readonly BotProfileId[] = []): string[] {
  if (profile !== "fwu") return [...SHARED_SLASH_COMMANDS, ...SLASH_COMMAND_OWNERS[profile]];
  const kept = BOT_PROFILE_IDS.filter((id) => id === "fwu" || !delegated.includes(id));
  return [...SHARED_SLASH_COMMANDS, ...kept.flatMap((id) => SLASH_COMMAND_OWNERS[id])];
}

/** Names FWU must remove from its own application once a domain is delegated. */
export function slashCommandNamesDelegatedAway(delegated: readonly BotProfileId[]): string[] {
  return delegated.flatMap((id) => (id === "fwu" ? [] : SLASH_COMMAND_OWNERS[id]));
}
