// Crash: the multiplier climbs tick by tick and blows up at a point drawn when
// the round opens. Cashing out before that pays the multiplier reached.
// The crash point is committed up front, so the outcome never depends on how
// fast Discord edits the message.
export const TICK_MS = 1600;
export const GROWTH = 1.07;
export const MAX_MULTIPLIER = 1000;
export const MAX_TICKS = 120;
const HOUSE_EDGE = 0.99;

/** Multiplier shown after `tick` ticks, two decimals. */
export const crashMultiplierAt = (tick) => Math.round(Math.pow(GROWTH, Math.max(0, tick)) * 100) / 100;

/**
 * Draws where the round blows up. `uniform()` returns a float in [0, 1).
 * 1% of rounds crash instantly at 1.00, which is the house edge.
 */
export function drawCrashPoint(uniform) {
  const u = uniform();
  if (!Number.isFinite(u) || u < 0 || u >= 1) throw new Error("Tirage invalide.");
  if (u < 1 - HOUSE_EDGE) return 1;
  return Math.min(MAX_MULTIPLIER, Math.floor((HOUSE_EDGE * 100) / (1 - u)) / 100);
}

export function newCrashGame({ bet, uniform, autoCashout = null }) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new Error("Mise invalide.");
  if (autoCashout !== null && (!Number.isFinite(autoCashout) || autoCashout < 1.01 || autoCashout > MAX_MULTIPLIER)) {
    throw new Error("L'encaissement automatique doit être compris entre 1.01 et 1000.");
  }
  return { bet, crashPoint: drawCrashPoint(uniform), tick: 0, phase: "running", cashedAt: null, autoCashout };
}

/** Advances one tick. The round ends as "crashed", or as "cashed" when the auto-cashout is reached. */
export function crashAdvance(state) {
  if (state.phase !== "running") return state;
  const next = structuredClone(state);
  next.tick += 1;
  const reached = crashMultiplierAt(next.tick);
  if (reached >= next.crashPoint) {
    next.phase = "crashed";
    return next;
  }
  if (next.autoCashout && reached >= next.autoCashout) {
    next.phase = "cashed";
    next.cashedAt = reached;
    return next;
  }
  if (next.tick >= MAX_TICKS) {
    next.phase = "cashed";
    next.cashedAt = reached;
  }
  return next;
}

/** Manual cash out at the multiplier currently displayed. */
export function crashCashout(state) {
  if (state.phase !== "running") throw new Error("La partie est déjà terminée.");
  const next = structuredClone(state);
  next.phase = "cashed";
  next.cashedAt = crashMultiplierAt(next.tick);
  return next;
}

/** Gross payout, stake included. */
export const crashPayout = (state) => (state.phase === "cashed" ? Math.floor(state.bet * state.cashedAt) : 0);
