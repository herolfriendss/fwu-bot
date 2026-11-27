// Anti-largage vocal. A network attack on Discord's voice server drops every member of a
// voice channel at once. A bot cannot stop the attack, but changing the channel's region
// moves everyone to another voice server within seconds. This module only detects the
// burst (pure, testable); the caller changes the region and alerts the staff.

export const DROP_WINDOW_MS = 8_000;      // disconnections counted together
export const DROP_MIN_MEMBERS = 3;        // at least this many dropped members…
export const DROP_MIN_SHARE = 0.5;        // …and at least half of the channel
export const DROP_COOLDOWN_MS = 2 * 60_000; // one region change per channel at most every 2 min
export const SUSPECT_WINDOW_MS = 2 * 60_000; // members who joined shortly before the burst
// Discord voice region ids. null = automatic. Rotating between them forces a new voice server.
export const REGION_ROTATION = Object.freeze(["rotterdam", null]);

export function nextRegion(current) {
  const index = REGION_ROTATION.indexOf(current ?? null);
  return REGION_ROTATION[(index + 1) % REGION_ROTATION.length];
}

/** Detector: feed joins and disconnections; disconnect() says when to react. */
export function createVoiceDropGuard({ now = Date.now, windowMs = DROP_WINDOW_MS, minMembers = DROP_MIN_MEMBERS, minShare = DROP_MIN_SHARE, cooldownMs = DROP_COOLDOWN_MS, suspectWindowMs = SUSPECT_WINDOW_MS } = {}) {
  const drops = new Map();   // channelKey -> [{ memberId, at }]
  const joins = new Map();   // channelKey -> Map(memberId -> at)
  const lastTrigger = new Map();
  const key = (guildId, channelId) => `${guildId}:${channelId}`;

  function prune(channelKey, t) {
    const list = (drops.get(channelKey) ?? []).filter((d) => t - d.at <= windowMs);
    if (list.length) drops.set(channelKey, list); else drops.delete(channelKey);
    const joined = joins.get(channelKey);
    if (joined) {
      for (const [memberId, at] of joined) if (t - at > suspectWindowMs) joined.delete(memberId);
      if (!joined.size) joins.delete(channelKey);
    }
    return list;
  }

  return {
    join(guildId, channelId, memberId) {
      const channelKey = key(guildId, channelId), t = now();
      prune(channelKey, t);
      if (!joins.has(channelKey)) joins.set(channelKey, new Map());
      joins.get(channelKey).set(memberId, t);
    },
    /**
     * Records one disconnection. remaining = members still in the channel after it.
     * Returns null, or { dropped, suspects } once per burst.
     */
    disconnect(guildId, channelId, memberId, remaining) {
      const channelKey = key(guildId, channelId), t = now();
      const list = prune(channelKey, t);
      if (!list.some((d) => d.memberId === memberId)) list.push({ memberId, at: t });
      drops.set(channelKey, list);
      const dropped = list.length;
      const before = dropped + Math.max(0, Number(remaining) || 0);
      if (dropped < minMembers || dropped / before < minShare) return null;
      if (t - (lastTrigger.get(channelKey) ?? -Infinity) < cooldownMs) return null;
      lastTrigger.set(channelKey, t);
      const droppedIds = list.map((d) => d.memberId);
      const suspects = [...(joins.get(channelKey) ?? new Map()).entries()]
        .filter(([, at]) => t - at <= suspectWindowMs)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      drops.delete(channelKey);
      return { dropped: droppedIds, suspects };
    },
  };
}
