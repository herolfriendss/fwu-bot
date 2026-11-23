const SNOWFLAKE = /^\d{5,25}$/;

/**
 * Reconcile persisted open sessions against a live Discord voice-state snapshot.
 * Times inferred from a startup snapshot are always marked approximate: the
 * bot cannot know exactly when a member left or moved while it was offline.
 */
export function reconcileVoiceSessions({
  db,
  transaction,
  guildId,
  activeMembers,
  now = Date.now(),
  recordEvent = () => {},
}) {
  if (!db?.prepare || typeof transaction !== "function") throw new Error("Database transaction is required.");
  if (typeof guildId !== "string" || !SNOWFLAKE.test(guildId)) throw new Error("Invalid guild id.");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid reconciliation timestamp.");

  const current = activeMembers instanceof Map ? new Map(activeMembers) : new Map(Object.entries(activeMembers ?? {}));
  for (const [userId, channelId] of current) {
    if (!SNOWFLAKE.test(String(userId)) || !SNOWFLAKE.test(String(channelId))) current.delete(userId);
  }

  const openSessions = db.prepare(`SELECT id,user_id,channel_id,joined_at,start_precision
    FROM voice_sessions WHERE guild_id=? AND left_at IS NULL`).all(guildId);
  const openByUser = new Map(openSessions.map((row) => [row.user_id, row]));
  const stats = { created: 0, closed: 0, moved: 0, unchanged: 0 };

  transaction(() => {
    for (const row of openSessions) {
      const currentChannelId = current.get(row.user_id) ?? null;
      if (currentChannelId === row.channel_id) {
        current.delete(row.user_id);
        stats.unchanged++;
        continue;
      }

      const durationMs = Math.max(0, now - Number(row.joined_at));
      const reason = currentChannelId ? "reconciled_channel_change" : "reconciled_offline_leave";
      const result = db.prepare(`UPDATE voice_sessions
        SET left_at=?,duration_ms=?,end_reason=?,end_precision='approximate'
        WHERE id=? AND left_at IS NULL`).run(now, durationMs, reason, row.id);
      if (!Number(result.changes)) continue;
      stats.closed++;
      openByUser.delete(row.user_id);
      if (currentChannelId) stats.moved++;

      recordEvent({
        guildId,
        eventKey: `voice-reconcile-close:${guildId}:${row.id}:${now}`,
        category: "voice",
        action: currentChannelId ? "déplacement_reconcilié" : "déconnexion_estimée",
        targetId: row.user_id,
        channelId: row.channel_id,
        details: {
          fromId: row.channel_id,
          toId: currentChannelId,
          durationMs,
          startPrecision: row.start_precision,
          endPrecision: "approximate",
          note: "Fin de session estimée à la reprise du bot ; l'heure exacte pendant l'indisponibilité est inconnue.",
        },
        occurredAt: now,
        source: "startup_snapshot",
      });
    }

    for (const [userId, channelId] of current) {
      if (openByUser.has(userId)) continue;
      db.prepare(`INSERT INTO voice_sessions(guild_id,user_id,channel_id,joined_at,start_precision)
        VALUES(?,?,?,?, 'approximate')`).run(guildId, userId, channelId, now);
      stats.created++;
      recordEvent({
        guildId,
        eventKey: `voice-reconcile-open:${guildId}:${userId}:${channelId}:${now}`,
        category: "voice",
        action: "présence_reconciliée",
        targetId: userId,
        channelId,
        details: {
          precision: "approximate",
          note: "Membre présent au démarrage ; heure réelle d'arrivée inconnue.",
        },
        occurredAt: now,
        source: "startup_snapshot",
      });
    }
  });

  return stats;
}
