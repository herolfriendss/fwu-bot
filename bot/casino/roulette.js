// European roulette (single zero, 37 pockets) with the full betting layout.
// Multipliers are gross returns: the stake is included, so a losing bet returns 0.
const RED = Object.freeze(new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]));
export const pocketColor = (n) => (n === 0 ? "vert" : RED.has(n) ? "rouge" : "noir");
export const COLOR_EMOJI = { rouge: "🔴", noir: "⚫", vert: "🟢" };

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const column = (index) => range(1, 36).filter((n) => n % 3 === index % 3);
const allNumbers = range(1, 36);

export const OUTSIDE_BETS = Object.freeze({
  rouge: { label: "Rouge", multiplier: 2, numbers: allNumbers.filter((n) => RED.has(n)) },
  noir: { label: "Noir", multiplier: 2, numbers: allNumbers.filter((n) => !RED.has(n)) },
  pair: { label: "Pair", multiplier: 2, numbers: allNumbers.filter((n) => n % 2 === 0) },
  impair: { label: "Impair", multiplier: 2, numbers: allNumbers.filter((n) => n % 2 === 1) },
  manque: { label: "Manque (1–18)", multiplier: 2, numbers: range(1, 18) },
  passe: { label: "Passe (19–36)", multiplier: 2, numbers: range(19, 36) },
  douzaine1: { label: "1re douzaine (1–12)", multiplier: 3, numbers: range(1, 12) },
  douzaine2: { label: "2e douzaine (13–24)", multiplier: 3, numbers: range(13, 24) },
  douzaine3: { label: "3e douzaine (25–36)", multiplier: 3, numbers: range(25, 36) },
  colonne1: { label: "1re colonne", multiplier: 3, numbers: column(1) },
  colonne2: { label: "2e colonne", multiplier: 3, numbers: column(2) },
  colonne3: { label: "3e colonne", multiplier: 3, numbers: column(0) },
});

const ALIASES = {
  red: "rouge", black: "noir", even: "pair", odd: "impair", bas: "manque", low: "manque",
  haut: "passe", high: "passe", p12: "douzaine1", m12: "douzaine2", d12: "douzaine3",
  d1: "douzaine1", d2: "douzaine2", d3: "douzaine3", c1: "colonne1", c2: "colonne2", c3: "colonne3",
};

const isNumber = (n) => Number.isInteger(n) && n >= 0 && n <= 36;

/** Two pockets touching on the felt, including the three splits with zero. */
function splitNumbers(a, b) {
  const [low, high] = [a, b].sort((x, y) => x - y);
  if (low === 0) return high >= 1 && high <= 3 ? [0, high] : null;
  if (high - low === 3 && high <= 36) return [low, high];
  if (high - low === 1 && Math.ceil(low / 3) === Math.ceil(high / 3)) return [low, high];
  return null;
}

/** Builds one bet from a layout position. Throws when the position does not exist. */
export function rouletteBet(type, value) {
  const key = ALIASES[String(type).toLowerCase()] ?? String(type).toLowerCase();
  if (OUTSIDE_BETS[key]) return { type: key, label: OUTSIDE_BETS[key].label, numbers: OUTSIDE_BETS[key].numbers, multiplier: OUTSIDE_BETS[key].multiplier };
  if (key === "plein") {
    const n = Number(value);
    if (!isNumber(n)) throw new Error("Numéro plein invalide (0 à 36).");
    return { type: "plein", label: `Plein ${n}`, numbers: [n], multiplier: 36 };
  }
  if (key === "cheval") {
    const parts = String(value).split(/[-/ ]+/).map(Number);
    const pair = parts.length === 2 && parts.every(isNumber) ? splitNumbers(parts[0], parts[1]) : null;
    if (!pair) throw new Error("Cheval invalide : les deux numéros doivent se toucher sur le tapis (ex. 5-6 ou 5-8).");
    return { type: "cheval", label: `Cheval ${pair.join("-")}`, numbers: pair, multiplier: 18 };
  }
  if (key === "transversale") {
    const n = Number(value);
    if (!isNumber(n) || n < 1 || n % 3 !== 1) throw new Error("Transversale invalide : commence par 1, 4, 7… jusqu'à 34.");
    return { type: "transversale", label: `Transversale ${n}-${n + 2}`, numbers: range(n, n + 2), multiplier: 12 };
  }
  if (key === "carre") {
    const n = Number(value);
    if (!isNumber(n) || n < 1 || n > 32 || n % 3 === 0) throw new Error("Carré invalide : donne le coin haut-gauche (1, 2, 4, 5…, 32).");
    return { type: "carre", label: `Carré ${n}`, numbers: [n, n + 1, n + 3, n + 4], multiplier: 9 };
  }
  if (key === "sixain") {
    const n = Number(value);
    if (!isNumber(n) || n < 1 || n > 31 || n % 3 !== 1) throw new Error("Sixain invalide : commence par 1, 4, 7… jusqu'à 31.");
    return { type: "sixain", label: `Sixain ${n}-${n + 5}`, numbers: range(n, n + 5), multiplier: 6 };
  }
  const direct = Number(key);
  if (isNumber(direct) && /^\d{1,2}$/.test(key)) return rouletteBet("plein", direct);
  throw new Error("Type de mise inconnu. Essaie : rouge, noir, pair, impair, manque, passe, douzaine1-3, colonne1-3, plein, cheval, transversale, carré, sixain.");
}

/**
 * Parses a free-text betting line, e.g. "rouge:100, 17:50, cheval 5-6:25".
 * Without a per-bet amount the bet uses `defaultAmount`.
 */
export function parseRouletteBets(text, defaultAmount) {
  const entries = String(text ?? "").split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  if (!entries.length) throw new Error("Indique au moins une mise.");
  if (entries.length > 12) throw new Error("12 mises au maximum par tour.");
  return entries.map((entry) => {
    const [head, rawAmount] = entry.split(":").map((part) => part.trim());
    const amount = rawAmount === undefined ? defaultAmount : Number(rawAmount);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error(`Mise invalide pour « ${head} ».`);
    const words = head.split(/\s+/);
    const bet = words.length > 1 ? rouletteBet(words[0], words.slice(1).join(" ")) : rouletteBet(words[0]);
    return { ...bet, amount };
  });
}

/** Settles every bet of one spin. */
export function resolveRouletteSpin(bets, number) {
  if (!isNumber(number)) throw new Error("Numéro de roulette invalide.");
  const results = bets.map((bet) => {
    const won = bet.numbers.includes(number);
    return { ...bet, won, payout: won ? bet.amount * bet.multiplier : 0 };
  });
  const totalBet = results.reduce((sum, r) => sum + r.amount, 0);
  const totalPayout = results.reduce((sum, r) => sum + r.payout, 0);
  return { number, color: pocketColor(number), results, totalBet, totalPayout, net: totalPayout - totalBet };
}
