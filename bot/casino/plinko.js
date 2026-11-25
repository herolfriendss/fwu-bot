// Plinko: a ball falls through 16 rows of pegs; each peg sends it left or right.
// The bucket it lands in decides the multiplier. Edges pay big, the middle loses.
export const ROWS = 16;
export const BUCKETS = ROWS + 1;

export const RISK_TABLES = Object.freeze({
  faible: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  moyen: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  fort: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
});
export const RISK_LEVELS = Object.freeze(Object.keys(RISK_TABLES));

/** Drops one ball. `rng(2)` decides each peg. Returns the path and the bucket. */
export function dropPlinko(rng) {
  const path = [];
  let bucket = 0;
  for (let row = 0; row < ROWS; row += 1) {
    const right = rng(2) === 1;
    path.push(right ? "D" : "G");
    if (right) bucket += 1;
  }
  return { path, bucket };
}

export function resolvePlinko({ bet, risk = "moyen", bucket }) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new Error("Mise invalide.");
  const table = RISK_TABLES[String(risk).toLowerCase()];
  if (!table) throw new Error("Risque invalide : faible, moyen ou fort.");
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= BUCKETS) throw new Error("Case d'arrivée invalide.");
  const multiplier = table[bucket];
  const payout = Math.floor(bet * multiplier);
  return { bucket, risk: String(risk).toLowerCase(), multiplier, payout, net: payout - bet, won: payout > bet };
}

export const plinkoTable = (risk = "moyen") => RISK_TABLES[String(risk).toLowerCase()] ?? null;
