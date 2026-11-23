export function createPndIntelligenceRateLimiter({ windowMs = 60_000, maxRequests = 3, maxKeys = 5_000 } = {}) {
  const requests = new Map();
  return {
    take(key, now = Date.now()) {
      const recent = (requests.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= maxRequests) return false;
      recent.push(now);
      requests.set(key, recent);
      if (requests.size > maxKeys) {
        for (const [candidate, times] of requests) {
          if (!times.some((time) => now - time < windowMs)) requests.delete(candidate);
          if (requests.size <= maxKeys) break;
        }
      }
      return true;
    },
    get size() { return requests.size; },
  };
}
