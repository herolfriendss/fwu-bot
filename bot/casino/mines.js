// Mines: a 5x5 grid hiding bombs. Every safe tile raises the multiplier and the
// player cashes out whenever they want. One bomb ends the round with nothing.
export const SIZE = 5;
export const TILES = SIZE * SIZE;
export const MIN_MINES = 1;
export const MAX_MINES = 24;
export const MAX_MULTIPLIER = 1000;
const HOUSE_EDGE = 0.99;

/** Fair multiplier after `safe` revealed tiles, capped so a payout stays bounded. */
export function minesMultiplier(mines, safe) {
  if (!Number.isInteger(mines) || mines < MIN_MINES || mines > MAX_MINES) throw new Error("Nombre de mines invalide (1 à 24).");
  if (!Number.isInteger(safe) || safe < 0 || safe > TILES - mines) throw new Error("Nombre de cases révélées invalide.");
  if (safe === 0) return 1;
  let multiplier = HOUSE_EDGE;
  for (let i = 0; i < safe; i += 1) multiplier *= (TILES - i) / (TILES - mines - i);
  return Math.min(MAX_MULTIPLIER, Math.round(multiplier * 100) / 100);
}

/** Picks `mines` distinct tiles. `rng(n)` returns an integer in [0, n). */
export function placeMines(mines, rng) {
  const pool = Array.from({ length: TILES }, (_, i) => i);
  const picked = [];
  for (let i = 0; i < mines; i += 1) picked.push(...pool.splice(rng(pool.length), 1));
  return picked.sort((a, b) => a - b);
}

export function newMinesGame({ bet, mines, rng }) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new Error("Mise invalide.");
  if (!Number.isInteger(mines) || mines < MIN_MINES || mines > MAX_MINES) throw new Error("Choisis entre 1 et 24 mines.");
  return { bet, mines, bombs: placeMines(mines, rng), revealed: [], phase: "playing", hit: null };
}

export const minesSafeCount = (state) => state.revealed.length;
export const minesCurrentMultiplier = (state) => minesMultiplier(state.mines, state.revealed.length);
export const minesCashoutValue = (state) => Math.floor(state.bet * minesCurrentMultiplier(state));
/** Multiplier the next safe tile would reach: shown on the button so the risk is explicit. */
export const minesNextMultiplier = (state) =>
  state.revealed.length >= TILES - state.mines ? null : minesMultiplier(state.mines, state.revealed.length + 1);

/** Reveals one tile. Returns the new state; `phase` becomes "lost" on a bomb. */
export function minesReveal(state, tile) {
  if (state.phase !== "playing") throw new Error("La partie est terminée.");
  if (!Number.isInteger(tile) || tile < 0 || tile >= TILES) throw new Error("Case invalide.");
  if (state.revealed.includes(tile)) throw new Error("Case déjà retournée.");
  const next = structuredClone(state);
  if (next.bombs.includes(tile)) {
    next.phase = "lost";
    next.hit = tile;
    return next;
  }
  next.revealed.push(tile);
  if (next.revealed.length >= TILES - next.mines) next.phase = "cleared";
  return next;
}

/** Stops the round and returns the gross payout, stake included. */
export function minesCashout(state) {
  if (state.phase === "lost") return { ...structuredClone(state), payout: 0 };
  if (!state.revealed.length) throw new Error("Retourne au moins une case avant d'encaisser.");
  const next = structuredClone(state);
  next.phase = "cashed";
  next.payout = minesCashoutValue(state);
  return next;
}

export const minesPayout = (state) => (state.phase === "lost" ? 0 : state.payout ?? minesCashoutValue(state));
