// PND Guardian P2 — score informatif, sans sanction automatique.
const WEIGHTS = Object.freeze({
  mention_flood: 30,
  link_flood: 25,
  rapid_messages: 25,
});

export const GUARDIAN_REVIEW_THRESHOLD = 50;
export const GUARDIAN_HIGH_RISK_THRESHOLD = 75;
export const GUARDIAN_RISK_WINDOW_MS = 15 * 60_000;

export function guardianSignalFromMessage({ mentionCount = 0, linkCount = 0, rapidCount = 0 } = {}) {
  const signals = [];
  if (Number.isSafeInteger(mentionCount) && mentionCount >= 5) {
    signals.push({ signal: "mention_flood", observed: Math.min(mentionCount, 100) });
  }
  if (Number.isSafeInteger(linkCount) && linkCount >= 3) {
    signals.push({ signal: "link_flood", observed: Math.min(linkCount, 100) });
  }
  if (Number.isSafeInteger(rapidCount) && rapidCount >= 5) {
    signals.push({ signal: "rapid_messages", observed: Math.min(rapidCount, 100) });
  }
  return signals;
}

export function scoreGuardianSignals(rows = []) {
  const counts = { mention_flood: 0, link_flood: 0, rapid_messages: 0 };
  const observed = { mention_flood: 0, link_flood: 0, rapid_messages: 0 };
  for (const row of rows) {
    if (!Object.hasOwn(WEIGHTS, row.signal)) continue;
    counts[row.signal] += 1;
    observed[row.signal] = Math.max(observed[row.signal], Number(row.observed) || 0);
  }
  const breakdown = Object.entries(counts).flatMap(([signal, count]) => count > 0
    ? [{ signal, occurrences: count, observed: observed[signal], weight: WEIGHTS[signal], score: Math.min(count, 3) * WEIGHTS[signal] }]
    : []);
  const score = Math.min(100, breakdown.reduce((total, item) => total + item.score, 0));
  return {
    score,
    severity: score >= GUARDIAN_HIGH_RISK_THRESHOLD ? "high" : score >= GUARDIAN_REVIEW_THRESHOLD ? "review" : score > 0 ? "watch" : "none",
    requiresReview: score >= GUARDIAN_REVIEW_THRESHOLD,
    signals: breakdown,
  };
}
