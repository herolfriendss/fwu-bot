// FWU — the former "=" commands and their slash replacement (owner decision 23/11/2026).
// Used to translate help texts written for "=" into slash commands, and by the
// parity test that guarantees every former command has a slash equivalent.

/** Former prefix → slash path ("root", "root sub" or "root group sub"). */
export const SLASH_FOR_PREFIX = Object.freeze({
  ticket: "ticket", candidature: "candidature", candidatures: "candidature liste", ia: "ia", pndia: "ia demande",
  profil: "profil", profile: "profil", bio: "bio", color: "color", couleur: "color", rep: "rep donner",
  rephistorique: "rep historique", rephistory: "rep historique", toprep: "toprep", card: "card", cards: "cards",
  pack: "pack", trade: "trade", trades: "trade liste", dice: "dice", coinflip: "coinflip", trivia: "trivia",
  giveaway: "giveaway", event: "event", pndevent: "pndevent", academy: "academy", award: "award", story: "story",
  radar: "radar", wrapped: "wrapped", afk: "afk", blacklist: "blacklist", live: "live",
  "guardian-review": "guildguard review", verification: "verify reaction",
  pv: "pv activer", unpv: "pv retirer", access: "access", unaccess: "unaccess", panel: "voc vocal-panel",
  demandevocal: "voc demander", play: "play", p: "play", pause: "pause", resume: "resume", skip: "skip", stop: "stop",
  queue: "queue", nowplaying: "nowplaying", np: "nowplaying", volume: "volume", vol: "volume", loop: "loop",
  shuffle: "shuffle", clearqueue: "clearqueue", remove: "remove", join: "join", leave: "leave",
  musicpanel: "musicpanel", radio: "radio",
  sysp: "sysp", rank: "rank", addrole: "rank", removerole: "removerole", rankall: "rankall", rolepanel: "rolepanel",
  staffhistory: "staffhistory", vocalpresence: "vocalpresence", lockname: "lockname proteger",
  unlockname: "lockname retirer", locknamelist: "lockname liste", automation: "automation",
  autorule: "automation regles creer", knowledge: "knowledge", dog: "dog", undog: "undog", doginfo: "doginfo",
  doglist: "dog", menotte: "menotte", unmenotte: "unmenotte", menotteinfo: "menotteinfo", wakeup: "wakeup",
  "anti-moove": "anti-moove", "anti-move": "anti-moove", wouaf: "wouaf", waouf: "wouaf", dmall: "dmall",
  balance: "balance", solde: "balance", daily: "daily", work: "work", job: "job", mission: "job mission status",
  bank: "bank", history: "history", rob: "rob", lottery: "lottery", pay: "pay", leaderboard: "leaderboard",
  inventory: "inventory", shop: "shop", buy: "buy", market: "shop market list", auction: "shop auction list",
  pnd: "pnd", "pnd-history": "pnd historique", "pnd-audit": "pnd audit", "pnd-add": "pnd ajouter",
  "pnd-remove": "pnd retirer", roulette: "roulette", blackjack: "blackjack", casino: "casino",
  business: "business", invest: "invest",
});

// Same-name commands keep their arguments ("=casino roulette" → "/casino roulette").
// These start with a default subcommand when used without arguments.
const DEFAULT_SUB = Object.freeze({ pv: "activer", rep: "donner" });

function slashFor(token, args) {
  const path = SLASH_FOR_PREFIX[token];
  if (!path) return null;
  const rest = args.trim();
  if (path.split(" ")[0] === token && !path.includes(" ")) {
    if (DEFAULT_SUB[token] && !/^(liste|retirer|historique|history|activer|donner)\b/i.test(rest)) return `/${token} ${DEFAULT_SUB[token]}${rest ? ` ${rest}` : ""}`;
    return `/${token}${rest ? ` ${rest}` : ""}`;
  }
  if (token === "guardian-review") return /^resolve\b/i.test(rest) ? `/guildguard resolve${rest.replace(/^resolve/i, "")}` : "/guildguard review";
  if (token === "pv" || token === "rep") {
    if (/^(liste)\b/i.test(rest)) return `/pv liste`;
    if (/^(historique|history)\b/i.test(rest)) return `/rep historique${rest.replace(/^(historique|history)/i, "")}`;
    return `/${path}${rest ? ` ${rest}` : ""}`;
  }
  return `/${path}${rest ? ` ${rest}` : ""}`;
}

/** Rewrites every `=command …` mention of a text into its slash equivalent. */
export function slashifyText(text) {
  if (typeof text !== "string" || !text.includes("`=")) return text;
  return text.replace(/`=([a-z][a-z0-9-]*)([^`\n]*)`/gi, (whole, token, args) => {
    const replacement = slashFor(token.toLowerCase(), args);
    return replacement ? `\`${replacement}\`` : whole;
  });
}

function slashifyEmbed(embed) {
  if (!embed) return embed;
  const data = typeof embed.toJSON === "function" ? embed.toJSON() : embed;
  return {
    ...data,
    ...(data.title ? { title: slashifyText(data.title) } : {}),
    ...(data.description ? { description: slashifyText(data.description) } : {}),
    ...(data.footer?.text ? { footer: { ...data.footer, text: slashifyText(data.footer.text) } } : {}),
    ...(Array.isArray(data.fields) ? { fields: data.fields.map((field) => ({ ...field, name: slashifyText(field.name), value: slashifyText(field.value) })) } : {}),
  };
}

/** Same rewrite for a whole reply payload (string or { content, embeds }). */
export function slashifyPayload(payload) {
  if (typeof payload === "string") return slashifyText(payload);
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  if (typeof out.content === "string") out.content = slashifyText(out.content);
  if (Array.isArray(out.embeds)) out.embeds = out.embeds.map(slashifyEmbed);
  return out;
}
