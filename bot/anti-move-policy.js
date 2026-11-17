export const ANTI_MOVE_AUDIT_LOOKBACK_MS = 5_000;

/**
 * Discord's MEMBER_MOVE audit entry does not expose target_id. We therefore
 * only accept a single, one-member entry to the same destination in a short
 * window. Anything ambiguous is ignored rather than risking a false kickback.
 */
export function findUniqueAntiMoveEntry(entries, { destinationChannelId, eventAt = Date.now(), actorId } = {}) {
  const candidates = [...(entries ?? [])].filter((entry) => {
    const channelId = entry?.extra?.channel?.id ?? entry?.extra?.channelId ?? entry?.extra?.channel_id;
    const count = Number(entry?.extra?.count);
    const createdAt = Number(entry?.createdTimestamp ?? 0);
    const executorId = entry?.executorId ?? entry?.executor?.id ?? null;
    return channelId === destinationChannelId
      && count === 1
      && createdAt >= eventAt - ANTI_MOVE_AUDIT_LOOKBACK_MS
      && createdAt <= Date.now() + 1_000
      && Boolean(executorId)
      && executorId !== actorId;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function isSuppressedAntiMoveReturn(map, guildId, userId, destinationChannelId, now = Date.now()) {
  const key = `${guildId}:${userId}:${destinationChannelId}`;
  const expiresAt = map.get(key);
  if (!expiresAt) return false;
  map.delete(key);
  return expiresAt >= now;
}
