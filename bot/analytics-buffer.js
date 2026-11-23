import { incrementDailyMetric } from "./organization.js";

const ALLOWED = new Set(["messages", "joins", "leaves"]);
const pending = new Map();

export function recordAnalyticsMetric(guildId, metric, amount = 1) {
  if (typeof guildId !== "string" || !/^\d{5,25}$/.test(guildId) || !ALLOWED.has(metric)) return false;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10_000) return false;
  const key = `${guildId}:${metric}`;
  pending.set(key, Math.min(1_000_000, (pending.get(key) ?? 0) + amount));
  return true;
}

/** Flush aggregated counters; failed counters remain queued for the next pass. */
export function flushAnalyticsMetrics(now = Date.now()) {
  let flushed = 0;
  for (const [key, amount] of pending) {
    const separator = key.indexOf(":");
    const guildId = key.slice(0, separator);
    const metric = key.slice(separator + 1);
    try {
      incrementDailyMetric(guildId, metric, amount, now);
      pending.delete(key);
      flushed += amount;
    } catch {
      // Keep the aggregate queued; never lose counters due to transient DB errors.
    }
  }
  return flushed;
}

export function pendingAnalyticsMetrics() {
  return [...pending.entries()].map(([key, amount]) => ({ key, amount }));
}
