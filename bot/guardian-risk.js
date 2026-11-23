// PND Guardian P2 — revue humaine des signaux, aucun bannissement/timeout automatique.
import { db, transaction } from "./database.js";
import {
  GUARDIAN_REVIEW_THRESHOLD,
  GUARDIAN_RISK_WINDOW_MS,
  guardianSignalFromMessage,
  scoreGuardianSignals,
} from "./guardian-risk-policy.js";

const validId = (value) => typeof value === "string" && /^\d{5,25}$/.test(value);
const validSignals = new Set(["mention_flood", "link_flood", "rapid_messages"]);

export function recordGuardianMessageRisk({ guildId, userId, messageId, mentionCount, linkCount, rapidCount, now = Date.now() }) {
  if (!validId(guildId) || !validId(userId) || typeof messageId !== "string" || !messageId || messageId.length > 64 || !Number.isSafeInteger(now) || now < 0) {
    return { recorded: false, assessment: scoreGuardianSignals([]), review: null };
  }
  const signals = guardianSignalFromMessage({ mentionCount, linkCount, rapidCount });
  if (!signals.length) return { recorded: false, assessment: scoreGuardianSignals([]), review: null };

  return transaction(() => {
    let inserted = 0;
    for (const item of signals) {
      if (!validSignals.has(item.signal)) continue;
      const result = db.prepare(`INSERT OR IGNORE INTO guardian_risk_signals
        (guild_id,user_id,event_key,signal,observed,occurred_at) VALUES(?,?,?,?,?,?)`)
        .run(guildId, userId, `message:${messageId}`, item.signal, item.observed, now);
      inserted += Number(result.changes);
    }
    const assessment = assessGuardianRisk(guildId, userId, now);
    let review = null;
    if (assessment.score >= GUARDIAN_REVIEW_THRESHOLD) {
      const open = db.prepare(`SELECT id FROM guardian_review_queue
        WHERE guild_id=? AND user_id=? AND status='pending'`).get(guildId, userId);
      if (open) {
        db.prepare(`UPDATE guardian_review_queue SET score=?,severity=?,signals_json=?,last_seen_at=? WHERE id=?`)
          .run(assessment.score, assessment.severity, JSON.stringify(assessment.signals), now, open.id);
        review = { id: Number(open.id), created: false, score: assessment.score, severity: assessment.severity };
      } else {
        const result = db.prepare(`INSERT INTO guardian_review_queue
          (guild_id,user_id,score,severity,status,signals_json,first_seen_at,last_seen_at)
          VALUES(?,?,?,?,'pending',?,?,?)`)
          .run(guildId, userId, assessment.score, assessment.severity, JSON.stringify(assessment.signals), now, now);
        review = { id: Number(result.lastInsertRowid), created: true, score: assessment.score, severity: assessment.severity };
      }
    }
    return { recorded: inserted > 0, assessment, review };
  });
}

export function assessGuardianRisk(guildId, userId, now = Date.now(), windowMs = GUARDIAN_RISK_WINDOW_MS) {
  if (!validId(guildId) || !validId(userId) || !Number.isSafeInteger(now) || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    return scoreGuardianSignals([]);
  }
  const rows = db.prepare(`SELECT signal,observed FROM guardian_risk_signals
    WHERE guild_id=? AND user_id=? AND occurred_at>=? AND occurred_at<=?
    ORDER BY occurred_at ASC`).all(guildId, userId, Math.max(0, now - windowMs), now);
  return scoreGuardianSignals(rows);
}

export function listGuardianReviews(guildId, limit = 20) {
  if (!validId(guildId)) return [];
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare(`SELECT id,user_id,score,severity,signals_json,first_seen_at,last_seen_at
    FROM guardian_review_queue WHERE guild_id=? AND status='pending'
    ORDER BY score DESC,last_seen_at DESC LIMIT ?`).all(guildId, bounded).map((row) => ({
      id: Number(row.id), userId: row.user_id, score: Number(row.score), severity: row.severity,
      signals: JSON.parse(row.signals_json), firstSeenAt: Number(row.first_seen_at), lastSeenAt: Number(row.last_seen_at),
    }));
}

export function resolveGuardianReview({ guildId, reviewId, reviewerId, outcome, note = "", now = Date.now() }) {
  if (!validId(guildId) || !validId(reviewerId) || !Number.isSafeInteger(reviewId) || reviewId < 1) throw new Error("Identifiants de revue invalides.");
  if (!["reviewed", "cleared"].includes(outcome)) throw new Error("Décision de revue invalide.");
  const cleanedNote = String(note ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  const result = db.prepare(`UPDATE guardian_review_queue SET status=?,reviewed_by=?,reviewed_at=?,review_note=?
    WHERE guild_id=? AND id=? AND status='pending'`).run(outcome, reviewerId, now, cleanedNote, guildId, reviewId);
  if (!Number(result.changes)) throw new Error("Revue introuvable ou déjà traitée.");
  return { id: reviewId, status: outcome, reviewerId, reviewedAt: now };
}

export async function handleGuardianReviewMessage(message) {
  const match = String(message?.content ?? "").trim().match(/^=guardian-review(?:\s+([a-z]+))?(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  if (!message.guild || !message.author || message.author.bot) return true;
  const permissions = message.member?.permissions;
  const allowed = message.guild.ownerId === message.author.id
    || permissions?.has?.(32n) || permissions?.has?.(8n)
    || permissions?.has?.("ManageGuild") || permissions?.has?.("Administrator");
  const reply = (content) => message.reply({ content, allowedMentions: { parse: [] } });
  if (!allowed) { await reply("⛔ La file Guardian est réservée au propriétaire et au staff avec Gérer le serveur ou Administrateur."); return true; }
  const action = (match[1] ?? "list").toLowerCase();
  const args = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);
  try {
    if (action === "list") {
      const rows = listGuardianReviews(message.guild.id);
      const lines = rows.map((item) => `• **#${item.id}** · <@${item.userId}> · score ${item.score}/100 (${item.severity}) · ${item.signals.map((signal) => signal.signal).join(", ")}`);
      await reply(`🛡️ **PND Guardian — file de revue**\n${lines.length ? lines.join("\n") : "Aucun dossier en attente."}\n\nLe score est informatif : aucune sanction n'est appliquée automatiquement.`);
      return true;
    }
    if (action === "resolve") {
      const id = Number(args[0]);
      const outcome = args[1];
      if (!Number.isSafeInteger(id) || !["reviewed", "cleared"].includes(outcome)) throw new Error("Utilise `=guardian-review resolve ID reviewed|cleared [note]`.");
      const result = resolveGuardianReview({ guildId: message.guild.id, reviewId: id, reviewerId: message.author.id, outcome, note: args.slice(2).join(" ") });
      await reply(`✅ Dossier Guardian **#${result.id}** clôturé : ${outcome === "reviewed" ? "examiné" : "classé sans suite"}. Aucune sanction n'a été déclenchée.`);
      return true;
    }
    throw new Error("Utilise `=guardian-review list` ou `=guardian-review resolve ID reviewed|cleared [note]`.");
  } catch (error) {
    await reply(`❌ ${error instanceof Error ? error.message : "Revue impossible."}`);
    return true;
  }
}

export function pruneGuardianRiskSignals(before = Date.now() - 30 * 24 * 60 * 60_000) {
  if (!Number.isSafeInteger(before) || before < 0) return 0;
  return Number(db.prepare("DELETE FROM guardian_risk_signals WHERE occurred_at<?").run(before).changes);
}

export function pruneGuardianReviews(before = Date.now() - 180 * 24 * 60 * 60_000) {
  if (!Number.isSafeInteger(before) || before < 0) return 0;
  return Number(db.prepare("DELETE FROM guardian_review_queue WHERE status IN ('reviewed','cleared') AND reviewed_at<?").run(before).changes);
}
