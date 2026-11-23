/**
 * Conservative anti-move policy.
 * Voluntary joins/leaves are never candidates. A restoration requires a
 * recent, destination-matching Discord Audit Log activity by exactly one
 * executor.
 *
 * Discord specifics this policy accounts for:
 * - MEMBER_MOVE and MEMBER_DISCONNECT entries carry NO target id. Discord
 *   only records the executor, the destination channel (moves) and a count.
 *   Requiring `entry.target.id` therefore made the module unable to ever
 *   restore anyone in production.
 * - Repeated moves by the same executor are aggregated into the existing
 *   entry: its `extra.count` grows while `createdTimestamp` stays the time
 *   of the first move. A fresh activity is either a brand-new entry or a
 *   known entry whose count increased since the previous snapshot.
 */
export function isVoiceRelocation(oldState, newState) {
  const guildId = newState?.guild?.id ?? oldState?.guild?.id;
  const memberId = newState?.id ?? oldState?.id;
  const fromChannelId = oldState?.channelId ?? null;
  const toChannelId = newState?.channelId ?? null;

  if (!guildId || !memberId || !fromChannelId || fromChannelId === toChannelId)
    return false;
  if (oldState?.id && newState?.id && oldState.id !== newState.id) return false;
  if (
    oldState?.guild?.id &&
    newState?.guild?.id &&
    oldState.guild.id !== newState.guild.id
  )
    return false;
  if (newState?.member?.user?.bot || oldState?.member?.user?.bot) return false;
  return true;
}

export function auditEntryCount(entry) {
  const count = Number(entry?.extra?.count ?? 1);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/** Builds the id → count snapshot used to detect aggregated increments. */
export function snapshotAuditCounts(entries) {
  const snapshot = new Map();
  for (const entry of entries ?? [])
    if (entry?.id) snapshot.set(String(entry.id), auditEntryCount(entry));
  return snapshot;
}

/**
 * Returns an actor only when the audit log provides exactly one executor
 * with a fresh matching activity. A move must match the actual destination
 * channel; stale entries, unchanged aggregated entries, entries explicitly
 * targeting someone else and several distinct executors all fail closed.
 *
 * `previousCounts` (Map id → count) is the snapshot taken before the event.
 * Without it, only entries created within `maxAgeMs` are considered.
 */
export function matchVoiceAuditEntries(
  entries,
  {
    targetId,
    botId,
    destinationChannelId = null,
    now = Date.now(),
    maxAgeMs = 8_000,
    previousCounts = null,
  } = {},
) {
  if (!targetId || !botId || !Array.isArray(entries)) return null;

  const matches = entries.filter((entry) => {
    const executorId = entry?.executor?.id ?? entry?.executorId ?? null;
    if (!executorId || executorId === botId || executorId === targetId)
      return false;
    // Some payloads/mocks may expose a target. When present it must be ours.
    const explicitTarget = entry?.target?.id ?? entry?.targetId ?? null;
    if (explicitTarget && explicitTarget !== targetId) return false;
    if (
      destinationChannelId &&
      (entry?.extra?.channel?.id ?? entry?.extra?.channelId) !==
        destinationChannelId
    )
      return false;

    const known =
      entry?.id != null &&
      previousCounts instanceof Map &&
      previousCounts.has(String(entry.id));
    if (known)
      return auditEntryCount(entry) > previousCounts.get(String(entry.id));
    const age = now - Number(entry?.createdTimestamp ?? 0);
    return Number.isFinite(age) && age >= -2_000 && age <= maxAgeMs;
  });

  const executors = new Set(
    matches.map((entry) => entry.executor?.id ?? entry.executorId),
  );
  if (executors.size !== 1) return null;
  return {
    actorId: [...executors][0],
    action: destinationChannelId ? "déplacement forcé" : "déconnexion forcée",
  };
}

/**
 * Sliding-window guard against restore ping-pong (an actor repeatedly
 * moving a protected member). Returns whether a new restore is allowed and
 * the pruned list of timestamps to store.
 */
export function restoreBudget(
  timestamps,
  { now = Date.now(), windowMs = 60_000, max = 3 } = {},
) {
  const recent = (timestamps ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) return { allowed: false, timestamps: recent };
  return { allowed: true, timestamps: [...recent, now] };
}
