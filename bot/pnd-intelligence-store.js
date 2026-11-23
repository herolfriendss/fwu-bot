import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { PND_INTELLIGENCE_ACTION_TYPES, validatePndIntelligenceAction } from "./pnd-intelligence-policy.js";

const TTL = 10 * 60_000;

export function createPndIntelligenceAction({ guildId, requesterId, sourceChannelId, action, now = Date.now() }) {
  if (![guildId, requesterId, sourceChannelId].every((value) => typeof value === "string" && /^\d{5,25}$/.test(value))) throw new Error("Contexte Discord invalide.");
  if (!action || typeof action !== "object" || !PND_INTELLIGENCE_ACTION_TYPES.includes(action.type)) {
    throw new Error("Action PND Intelligence invalide.");
  }
  const safeAction = validatePndIntelligenceAction(action);
  const actionId = randomUUID();
  db.prepare(`INSERT INTO pnd_intelligence_actions
    (action_id,guild_id,requester_id,source_channel_id,action_json,status,expires_at,created_at)
    VALUES(?,?,?,?,?,'pending',?,?)`).run(actionId, guildId, requesterId, sourceChannelId, JSON.stringify(safeAction), now + TTL, now);
  return { actionId, expiresAt: now + TTL, action: safeAction };
}


/**
 * A bot crash can happen after a Discord action succeeds but before SQLite is
 * updated. Never retry such an action automatically: mark the outcome unknown
 * so staff can inspect Discord manually rather than duplicate a role/channel
 * or announcement.
 */
export function recoverInterruptedPndIntelligenceActions(now = Date.now(), staleAfterMs = 5 * 60_000) {
  const cutoff = now - Math.max(60_000, Number(staleAfterMs) || 5 * 60_000);
  const result = db.prepare(`
    UPDATE pnd_intelligence_actions
    SET status='failed',
        result_json=?
    WHERE status='processing' AND decided_at IS NOT NULL AND decided_at<=?
  `).run(JSON.stringify({
    code: "EXECUTION_INTERRUPTED",
    message: "Exécution interrompue après confirmation. Le résultat Discord est incertain : vérifier le serveur manuellement avant toute nouvelle demande.",
    outcome: "unknown",
  }), cutoff);
  return Number(result.changes);
}

export function expirePendingPndIntelligenceActions(now = Date.now()) {
  return Number(db.prepare("UPDATE pnd_intelligence_actions SET status='expired',decided_at=? WHERE status='pending' AND expires_at<=?").run(now, now).changes);
}
