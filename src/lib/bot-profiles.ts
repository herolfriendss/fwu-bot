// FWU multi-bot ownership map, shared by the dashboard and every bot process.
// Five core applications plus optional Invest +. FWU keeps its existing
// application and token; each specialised application owns one command domain.
// Plain, erasable TypeScript only: the Oracle bot imports this file directly.

export type BotProfileId = "fwu" | "guard" | "fdpdlavoc" | "suckme" | "fisc" | "investplus";

export type BotProfile = {
  id: BotProfileId;
  label: string;
  /** Environment variable holding this application's token. */
  tokenEnv: string;
  /** Optional per-bot guild allowlist (falls back to V4_ALLOWED_GUILD_IDS). */
  guildAllowlistEnv: string;
  summary: string;
  /** True when this application may be absent without degrading the five core FWU bots. */
  optional?: boolean;
};

export const BOT_PROFILES: Record<BotProfileId, BotProfile> = {
  fwu: {
    id: "fwu",
    label: "Bot principal",
    tokenEnv: "DISCORD_TOKEN",
    guildAllowlistEnv: "V4_ALLOWED_GUILD_IDS",
    summary: "Modération staff (tempmute, warn, sanctions, quotas) et embeds — slash uniquement",
  },
  guard: {
    id: "guard",
    label: "GUARD",
    tokenEnv: "PND_GUARD_TOKEN",
    guildAllowlistEnv: "PND_GUARD_GUILD_IDS",
    summary: "Administration lourde (+ban, +kick, blacklist), GuildGuard, vérification, anti-spam",
  },
  fdpdlavoc: {
    id: "fdpdlavoc",
    label: "FDPDLAVOC",
    tokenEnv: "PND_FDPDLAVOC_TOKEN",
    guildAllowlistEnv: "PND_FDPDLAVOC_GUILD_IDS",
    summary: "Musique, radio, vocaux temporaires, accès vocaux, ;mv et ;accessall",
  },
  suckme: {
    id: "suckme",
    label: "SUCK ME",
    tokenEnv: "PND_SUCKME_TOKEN",
    guildAllowlistEnv: "PND_SUCKME_GUILD_IDS",
    summary: "SYS+, rôles, DOG, MENOTTE, LOCKNAME, communauté (tickets, social, giveaways, AFK, IA)",
  },
  fisc: {
    id: "fisc",
    label: "LE FISC",
    tokenEnv: "PND_FISC_TOKEN",
    guildAllowlistEnv: "PND_FISC_GUILD_IDS",
    summary: "Économie, casino, jeux et cartes",
  },
  // Ajouté le 25/11/2026 : abonnements des membres, espace privé par membre, administration.
  investplus: {
    id: "investplus",
    label: "Invest +",
    tokenEnv: "PND_INVESTPLUS_TOKEN",
    guildAllowlistEnv: "PND_INVESTPLUS_GUILD_IDS",
    summary: "Abonnements des membres, espace privé par membre, administration des formules",
    optional: true,
  },
};

export const BOT_PROFILE_IDS = Object.keys(BOT_PROFILES) as BotProfileId[];

/** Registered on every application: each bot answers for itself. */
export const SHARED_SLASH_COMMANDS: readonly string[] = ["aide", "status"];

/**
 * Explicit slash ownership (never derived from help categories, which change).
 * Migration du 24/11/2026 : FWU = modération staff + embeds (slash uniquement) ;
 * GUARD = administration lourde (ban, kick…) ; les autres commandes de FWU sont
 * réparties entre SUCK ME (communauté) et LE FISC (jeux). Une commande n'existe
 * que sur son bot : aucune application n'enregistre les commandes d'une autre.
 */
export const SLASH_COMMAND_OWNERS: Record<BotProfileId, readonly string[]> = {
  fwu: [
    "tempmute", "unmute", "warn", "warnings", "sanction", "sanction-type", "quota",
    "embed", "reglement", "screening",
    // 27/11 : dernier message supprimé ou modifié (staff)
    "snipe",
  ],
  guard: [
    "guildguard", "kick", "ban", "tempban", "blacklist", "purge", "nettoyer", "slowmode", "lock", "unlock", "verify",
    "antinuke", "automod", "casier", "quarantaine", "bouclier",
    // V2 (26/11) : anti-raid
    "piege", "raid", "scan", "panic",
    // 27/11 : doubles comptes (ressemblance avec un banni)
    "doublecompte",
  ],
  fdpdlavoc: [
    "voice", "voc", "music", "radio", "effet", "playlist", "dj", "pv", "unpv",
    // 27/11 : blind test vocal, lecture vocale pour les muets
    "blindtest", "lecture",
    // V2 (26/11) : vocal de masse
    "accessall", "mvall", "mvrole", "pull", "swap", "muteall", "unmuteall", "vclear", "undo",
  ],
  suckme: [
    "sysp", "panel", "setup", "knowledge", "rank", "rankall", "removerole", "rolepanel",
    "staffhistory", "vocalpresence", "lockname", "webhook", "automation",
    "anti-moove", "wakeup", "dog", "undog", "doginfo", "wouaf", "menotte", "unmenotte", "menotteinfo",
    "dmall", "undogall", "roletemp", "annonce", "staff", "pseudo", "maj",
    // venues de FWU
    "ia", "ticket", "candidature", "sondage", "profil", "bio", "rep", "toprep", "color",
    "academy", "award", "story", "radar", "wrapped", "giveaway", "event", "pndevent", "afk", "live",
    "niveau", "suggestion", "anniversaire", "rappel", "stats", "confession", "moi", "fwu", "clan", "saison", "quete",
    // animation (25/11) : une seule commande racine, /anim comptage|vedette|qdj
    "anim",
    // outils staff (25/11) : /outils sticky|modmail
    "outils",
    // V2 (26/11) : journaux typés et dossiers
    "logs", "dossier", "blr", "guide", "pourquoi", "presence", "stabilite", "smash",
    // 27/11 : relations entre membres (mariage, adoption, arbre), salons compteurs
    "famille", "compteurs", "invitations",
  ],
  fisc: [
    "balance", "daily", "work", "job", "bank", "history", "rob", "lottery", "pay", "leaderboard",
    "inventory", "shop", "buy", "pnd", "roulette", "blackjack", "business", "invest", "casino",
    "impots", "pret", "duel", "pari", "avantage",
    // venues de FWU
    "dice", "coinflip", "trivia", "cards", "card", "pack", "trade",
    // jeux entre membres (25/11) : une seule commande racine, /jeu morpion|puissance4|pendu
    "jeu",
    // 27/11 : braquage en équipe de la caisse du serveur, prime sur un membre
    "braquage", "prime",
  ],
  investplus: ["abonnement", "investadmin"],
};

/**
 * Prefix commands: the first word decides which bot answers. Each bot reads
 * them with its own prefix (bot/config/bots.json); the handlers themselves
 * still parse the historical "=" form, the runtime rewrites the prefix.
 * FWU has no prefix command: slash only.
 */
export const PREFIX_COMMAND_OWNERS: Record<BotProfileId, readonly string[]> = {
  fwu: [],
  guard: [
    "ban", "tempban", "unban", "kick", "blacklist", "purge", "nettoyer", "slowmode", "lock", "unlock",
    "guardian-review", "verification", "piege", "raid", "scan", "panic", "doublecompte",
  ],
  fdpdlavoc: [
    "pv", "unpv", "access", "unaccess", "panel", "demandevocal", "mv", "accessall",
    "mvall", "moveall", "mvrole", "pull", "swap", "muteall", "unmuteall", "vclear", "undo",
    "play", "p", "pause", "resume", "skip", "stop", "queue", "nowplaying", "np", "volume", "vol",
    "loop", "shuffle", "clearqueue", "remove", "join", "leave", "musicpanel", "radio",
  ],
  suckme: [
    "sysp", "rank", "addrole", "removerole", "rankall", "rolepanel", "staffhistory", "vocalpresence",
    "lockname", "unlockname", "locknamelist", "automation", "autorule", "knowledge",
    "dog", "undog", "doginfo", "doglist", "menotte", "unmenotte", "menotteinfo", "wakeup",
    "anti-moove", "anti-move", "wouaf", "waouf", "dmall", "logs", "dossier", "blr", "guide", "pourquoi",
    // venues de FWU
    "ticket", "candidature", "candidatures", "ia", "pndia",
    "profil", "profile", "bio", "color", "couleur", "rep", "rephistorique", "rephistory", "toprep",
    "giveaway", "event", "pndevent", "academy", "award", "story", "radar", "wrapped", "afk", "live",
  ],
  fisc: [
    "balance", "solde", "daily", "work", "job", "mission", "bank", "history", "rob", "lottery", "pay",
    "leaderboard", "inventory", "shop", "buy", "market", "auction", "pnd", "pnd-history", "pnd-audit",
    "pnd-add", "pnd-remove", "roulette", "blackjack", "casino", "business", "invest",
    // venues de FWU
    "dice", "coinflip", "trivia", "card", "cards", "pack", "trade", "trades",
  ],
  investplus: ["abonnement", "abo"],
};

/**
 * Answered by every prefix bot with its own prefix ("+aide", ";aide", "=help"…):
 * each bot lists its own commands. Not owned by any single bot.
 */
export const SHARED_PREFIX_COMMANDS: readonly string[] = ["aide", "help", "commandes"];

/** Default prefixes (overridable in bot/config/bots.json). null = slash only. */
export const DEFAULT_PREFIXES: Record<BotProfileId, string | null> = {
  fwu: null,
  guard: "+",
  fdpdlavoc: ";",
  suckme: "=",
  fisc: "-",
  investplus: "$",
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

/**
 * V2 (26/11) : toute commande slash d'un bot à préfixe fonctionne aussi avec ce préfixe
 * (pont générique bot/prefix-slash-bridge.js). FWU reste en slash uniquement (décision 21).
 * Un nom déjà pris par une commande préfixe d'un autre bot n'est jamais réattribué.
 */
export const BRIDGED_PREFIX_COMMANDS: Record<BotProfileId, readonly string[]> = Object.fromEntries(
  BOT_PROFILE_IDS.map((id) => [id, id === "fwu" ? [] : SLASH_COMMAND_OWNERS[id].filter((name) => !prefixOwners.has(name))]),
) as unknown as Record<BotProfileId, readonly string[]>;
for (const id of BOT_PROFILE_IDS) for (const name of BRIDGED_PREFIX_COMMANDS[id]) prefixOwners.set(name, id);

/** True when `name` reaches the slash handler through the prefix bridge on `profile`. */
export function isBridgedPrefixCommand(profile: BotProfileId, name: string): boolean {
  return profile !== "fwu" && SLASH_COMMAND_OWNERS[profile].includes(String(name ?? "").toLowerCase());
}

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

/** Parse "guard,fisc" (legacy PND_FWU_DELEGATED, kept for the dashboard; no effect on commands). */
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

/** Names one application registers: its own commands only (plus /aide and /status). */
export function slashCommandNamesForProfile(profile: BotProfileId, _delegated: readonly BotProfileId[] = []): string[] {
  return [...SHARED_SLASH_COMMANDS, ...SLASH_COMMAND_OWNERS[profile]];
}

/** Names an application must remove from itself: every command owned by another bot. */
export function slashCommandNamesOwnedElsewhere(profile: BotProfileId): string[] {
  return BOT_PROFILE_IDS.filter((id) => id !== profile).flatMap((id) => SLASH_COMMAND_OWNERS[id]);
}

/** Legacy name kept for the dashboard: commands FWU must not expose. */
export function slashCommandNamesDelegatedAway(_delegated: readonly BotProfileId[] = []): string[] {
  return slashCommandNamesOwnedElsewhere("fwu");
}

/**
 * Validate a prefix map: 1 to 3 non-alphanumeric characters, no "/" (slash
 * commands), all different, FWU without prefix. Throws with a clear message.
 */
export function validatePrefixes(prefixes: Record<string, unknown>): Record<BotProfileId, string | null> {
  const out = { ...DEFAULT_PREFIXES };
  const seen = new Map<string, BotProfileId>();
  for (const id of BOT_PROFILE_IDS) {
    const value = Object.prototype.hasOwnProperty.call(prefixes ?? {}, id) ? prefixes[id] : DEFAULT_PREFIXES[id];
    if (id === "fwu") {
      if (value !== null && value !== undefined && value !== "") throw new Error("FWU fonctionne en commandes slash uniquement : son préfixe doit être null.");
      out.fwu = null;
      continue;
    }
    if (typeof value !== "string" || !/^[^\p{L}\p{N}\s/@#<>`]{1,3}$/u.test(value)) {
      throw new Error(`Préfixe invalide pour ${BOT_PROFILES[id].label} : 1 à 3 symboles (pas de lettre, chiffre, espace, / @ # < > \`).`);
    }
    for (const [other, owner] of seen) {
      if (other === value || other.startsWith(value) || value.startsWith(other)) {
        throw new Error(`Préfixes en conflit : ${BOT_PROFILES[owner].label} « ${other} » et ${BOT_PROFILES[id].label} « ${value} ».`);
      }
    }
    seen.set(value, id);
    out[id] = value;
  }
  return out;
}

/**
 * Read a message as a prefix command. Returns the owning bot, the command word,
 * and the canonical "=word args" form the handlers parse; null otherwise.
 */
export function parsePrefixedMessage(content: string, prefixes: Record<BotProfileId, string | null>): { owner: BotProfileId; prefix: string; word: string; canonical: string } | null {
  const text = String(content ?? "").trim();
  for (const id of BOT_PROFILE_IDS) {
    const prefix = prefixes[id];
    if (!prefix || !text.startsWith(prefix)) continue;
    const rest = text.slice(prefix.length);
    const match = /^([a-z][a-z0-9-]{0,30})(?=$|\s)/i.exec(rest);
    if (!match) return null;
    const word = (match[1] ?? "").toLowerCase();
    if (prefixOwners.get(word) !== id && !SHARED_PREFIX_COMMANDS.includes(word)) return null;
    return { owner: id, prefix, word, canonical: `=${rest}` };
  }
  return null;
}

/**
 * A built-in command typed with ANOTHER bot's prefix ("=pv" while pv belongs to
 * FDPDLAVOC, whose prefix is ";"). Only the owning bot uses this, to tell the
 * member the right form; the command itself is never run.
 */
export function misprefixedCommand(content: string, prefixes: Record<BotProfileId, string | null>): { owner: BotProfileId; typedPrefix: string; word: string; correct: string } | null {
  const text = String(content ?? "").trim();
  if (parsePrefixedMessage(text, prefixes)) return null;
  for (const id of BOT_PROFILE_IDS) {
    const typedPrefix = prefixes[id];
    if (!typedPrefix || !text.startsWith(typedPrefix)) continue;
    const match = /^([a-z][a-z0-9-]{0,30})(?=$|\s)/i.exec(text.slice(typedPrefix.length));
    if (!match) return null;
    const word = (match[1] ?? "").toLowerCase();
    const owner = prefixOwners.get(word);
    const ownerPrefix = owner ? prefixes[owner] : null;
    if (!owner || owner === id || !ownerPrefix) return null;
    return { owner, typedPrefix, word, correct: `${ownerPrefix}${word}` };
  }
  return null;
}
