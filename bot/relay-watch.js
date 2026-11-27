// Relay alerts: tells when this process starts or stops covering another bot's domain
// (e.g. GUARD offline, the main bot runs its protections). A change must last for
// `stableTicks` checks in a row, so a bot restarting in a few seconds raises no alert.
export const RELAY_ALERT_DOMAINS = Object.freeze(["guard", "suckme"]);

export function createRelayWatcher({ stableTicks = 2, domains = RELAY_ALERT_DOMAINS } = {}) {
  const active = new Set();
  const streak = new Map();
  return {
    /** relayed = domains served for another bot right now. Returns { started, stopped }. */
    update(relayed) {
      const now = new Set([...relayed].filter((domain) => domains.includes(domain)));
      const started = [];
      const stopped = [];
      for (const domain of domains) {
        const want = now.has(domain);
        if (want === active.has(domain)) { streak.delete(domain); continue; }
        const count = (streak.get(domain) ?? 0) + 1;
        if (count < stableTicks) { streak.set(domain, count); continue; }
        streak.delete(domain);
        if (want) { active.add(domain); started.push(domain); } else { active.delete(domain); stopped.push(domain); }
      }
      return { started, stopped };
    },
    get active() { return [...active]; },
  };
}

// Mode dégradé : while GUARD is covered by a relay, new members need a verified e-mail and
// 10 minutes on the server before writing (Discord's "High" level, 3). Restored afterwards.
export const DEGRADED_LEVEL = 3;
export function degradedPlan(currentLevel, saved) {
  if (saved !== undefined && saved !== null) return { change: false };
  return Number(currentLevel) < DEGRADED_LEVEL ? { change: true, to: DEGRADED_LEVEL, previous: Number(currentLevel) } : { change: false };
}
export function restorePlan(currentLevel, saved) {
  if (saved === undefined || saved === null) return { change: false };
  // Someone changed it by hand meanwhile: leave their choice.
  return Number(currentLevel) === DEGRADED_LEVEL && Number(saved) !== DEGRADED_LEVEL ? { change: true, to: Number(saved) } : { change: false };
}
