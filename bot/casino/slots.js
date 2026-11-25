// 3x3 slot machine with 5 paylines, a wild that substitutes, scatters that pay
// anywhere and award free spins, and a progressive jackpot on three sevens.
export const WILD = "🃏";
export const SCATTER = "💰";

const REEL = Object.freeze([
  { symbol: "🍒", weight: 30 }, { symbol: "🍋", weight: 24 }, { symbol: "🍉", weight: 18 },
  { symbol: "🔔", weight: 13 }, { symbol: "⭐", weight: 8 }, { symbol: "💎", weight: 4 },
  { symbol: "7️⃣", weight: 2 }, { symbol: WILD, weight: 3 }, { symbol: SCATTER, weight: 3 },
]);
const TOTAL_WEIGHT = REEL.reduce((sum, item) => sum + item.weight, 0);

/** Per-line multiplier, applied to the stake of one line (total bet / 5). */
const PAYTABLE = Object.freeze({
  "7️⃣": { three: 100, two: 10 }, "💎": { three: 50, two: 5 }, "⭐": { three: 25, two: 3 },
  "🔔": { three: 15, two: 2 }, "🍉": { three: 10, two: 0 }, "🍋": { three: 7, two: 0 }, "🍒": { three: 5, two: 0 },
});

export const PAYLINES = Object.freeze([
  { name: "Ligne du milieu", cells: [[0, 1], [1, 1], [2, 1]] },
  { name: "Ligne du haut", cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "Ligne du bas", cells: [[0, 2], [1, 2], [2, 2]] },
  { name: "Diagonale descendante", cells: [[0, 0], [1, 1], [2, 2]] },
  { name: "Diagonale montante", cells: [[0, 2], [1, 1], [2, 0]] },
]);
export const LINE_COUNT = PAYLINES.length;
export const FREE_SPINS_AWARD = 10;

function drawSymbol(rng) {
  let value = rng(TOTAL_WEIGHT);
  for (const item of REEL) {
    value -= item.weight;
    if (value < 0) return item.symbol;
  }
  return REEL[0].symbol;
}

/** grid[column][row], three columns of three symbols. */
export function spinSlots(rng) {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => drawSymbol(rng)));
}

/** Longest run from the left, wilds substituting for the base symbol. */
function lineRun(symbols) {
  const base = symbols.find((s) => s !== WILD && s !== SCATTER);
  if (!base) {
    return symbols.every((s) => s === WILD) ? { symbol: "7️⃣", length: 3, allWild: true } : { symbol: null, length: 0 };
  }
  let length = 0;
  for (const symbol of symbols) {
    if (symbol === base || symbol === WILD) length += 1;
    else break;
  }
  return { symbol: base, length };
}

/**
 * Settles one spin. `payout` is the gross return, stake included.
 * `jackpotWon` means three sevens landed on a payline: the caller pays the pot on top.
 */
export function resolveSlots({ bet, grid }) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new Error("Mise invalide.");
  if (!Array.isArray(grid) || grid.length !== 3 || grid.some((col) => !Array.isArray(col) || col.length !== 3)) {
    throw new Error("Grille de machine à sous invalide.");
  }
  const lineStake = bet / LINE_COUNT;
  const lines = [];
  let multiplier = 0;
  let jackpotWon = false;

  for (const line of PAYLINES) {
    const symbols = line.cells.map(([col, row]) => grid[col][row]);
    const run = lineRun(symbols);
    const pay = PAYTABLE[run.symbol];
    if (!pay) continue;
    const factor = run.length === 3 ? pay.three : run.length === 2 ? pay.two : 0;
    if (!factor) continue;
    if (run.symbol === "7️⃣" && run.length === 3) jackpotWon = true;
    multiplier += factor;
    lines.push({ name: line.name, symbol: run.symbol, length: run.length, factor, win: Math.floor(lineStake * factor) });
  }

  const scatters = grid.flat().filter((s) => s === SCATTER).length;
  const scatterWin = scatters >= 3 ? bet * 10 : scatters === 2 ? bet * 2 : 0;
  const freeSpins = scatters >= 3 ? FREE_SPINS_AWARD : 0;
  const payout = Math.floor(lineStake * multiplier) + scatterWin;

  return { grid, lines, scatters, scatterWin, freeSpins, jackpotWon, payout, net: payout - bet, won: payout > 0 };
}

export const slotsPaytable = () => PAYTABLE;
