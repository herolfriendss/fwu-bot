import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PREFIX_COMMAND_OWNERS } from "./bot-runtime.js";

const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");

// Owner decision (23/11/2026): every former "=" command must be reachable with a slash command.
// Each entry: former prefix → slash path ("root" or "root sub" or "root group sub").
const SLASH_FOR_PREFIX = {
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
};

function pathExists(path) {
  const [root, ...rest] = path.split(" ");
  let node = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS].find((command) => command.name === root);
  for (const part of rest) node = node?.options?.find((option) => option.name === part && option.type <= 2);
  return Boolean(node);
}

test("every former = command has a slash equivalent", () => {
  const tokens = Object.values(PREFIX_COMMAND_OWNERS).flat();
  const missing = tokens.filter((token) => !SLASH_FOR_PREFIX[token]);
  assert.deepEqual(missing, [], "commande = sans équivalent slash déclaré");
  const broken = Object.entries(SLASH_FOR_PREFIX).filter(([, path]) => !pathExists(path)).map(([token, path]) => `${token} → /${path}`);
  assert.deepEqual(broken, [], "chemin slash introuvable dans le catalogue");
});

test("= commands are off unless explicitly re-enabled", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /PREFIX_COMMANDS_ENABLED = String\(process\.env\.PND_PREFIX_COMMANDS \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "on"/);
  assert.match(source, /const runCmd = \(domain\) => !prefixBlocked && /);
  assert.match(source, /const command = prefixBlocked \? null : resolvePrefixCommand/);
});
