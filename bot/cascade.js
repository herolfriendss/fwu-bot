// What one bot does, the others answer to.
//
// Rules read the shared event bus and apply their effect across the whole
// ecosystem: a GUARD warning freezes the casino, a level-up pays a bonus from
// LE FISC, a ban closes the economy. One bot runs this loop (the one serving
// "fwu"); if it is offline the events wait and are caught up on its return.
import { db, transaction } from "./database.js";
import { consumeEvents, initCursor, publishEventSafe, EVENT_KINDS } from "./event-bus.js";
import { applySanction, liftSanction, invalidateTrust, expireSanctions, SANCTION_SCOPES } from "./trust.js";
import { addClanPoints, dueSeasons, closeSeason } from "./features/clans.js";

export const CASCADE_CONSUMER = "cascade:core";
const MAX_BALANCE = 1_000_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

db.exec(`CREATE TABLE IF NOT EXISTS fwu_cascade_done (
  event_id INTEGER NOT NULL, rule TEXT NOT NULL, done_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, rule)
);`);

/** True the first time only: protects a payout from a replay after a crash. */
const claim = (eventId, rule, now) =>
  Number(db.prepare("INSERT OR IGNORE INTO fwu_cascade_done(event_id,rule,done_at) VALUES(?,?,?)")
    .run(eventId, rule, now).changes) > 0;

/** Pays a bonus into the wallet LE FISC manages. Never creates money twice for one event. */
export function grantPnd({ eventId, rule, guildId, userId, amount, reason, now = Date.now() }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
  return transaction(() => {
    if (!claim(eventId, rule, now)) return 0;
    db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
    const given = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance<=?")
      .run(amount, guildId, userId, MAX_BALANCE - amount);
    if (!Number(given.changes)) return 0;
    db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
      .run(guildId, userId, amount, reason, now);
    return amount;
  });
}

/** Level-up bonus: grows with the level but flattens, so grinding stays honest. */
export const levelBonus = (level) => Math.min(25_000, 250 + Math.floor(Number(level) || 0) * 150);

/**
 * The rule table. `scopes` lists what a sanction freezes, `ms` for how long.
 * Keeping it declarative means the cascade can be read in one screen.
 */
export const SANCTION_RULES = Object.freeze({
  "member.warned": { scopes: ["casino"], ms: 2 * HOUR, label: "avertissement" },
  "member.muted": { scopes: ["casino", "dj", "social"], ms: 6 * HOUR, label: "exclusion temporaire" },
  "member.kicked": { scopes: ["casino", "economie", "dj"], ms: 3 * DAY, label: "expulsion" },
  "member.banned": { scopes: SANCTION_SCOPES, ms: 30 * DAY, label: "bannissement" },
  "member.quarantined": { scopes: SANCTION_SCOPES, ms: 7 * DAY, label: "quarantaine" },
});

/** Pure: what one event should trigger, with no database access. */
export function planFor(event) {
  const actions = [];
  const sanction = SANCTION_RULES[event.kind];
  if (sanction && event.subjectId) {
    actions.push({ type: "sanction", scopes: sanction.scopes, ms: event.payload?.durationMs ?? sanction.ms, label: sanction.label });
    actions.push({ type: "retrust" });
  }
  if (event.kind === "member.unbanned" && event.subjectId) {
    actions.push({ type: "lift", scopes: SANCTION_SCOPES });
    actions.push({ type: "retrust" });
  }
  if (event.kind === "member.verified" && event.subjectId) actions.push({ type: "retrust" });
  if (event.kind === "member.levelup" && event.subjectId) {
    actions.push({ type: "grant", amount: levelBonus(event.payload?.level), reason: "niveau_bonus", label: `niveau ${event.payload?.level ?? "?"}` });
    actions.push({ type: "clan", points: 10 * (Number(event.payload?.level) || 1), label: "passage de niveau" });
    actions.push({ type: "retrust" });
  }
  if (event.kind === "member.birthday" && event.subjectId) {
    actions.push({ type: "grant", amount: 5000, reason: "anniversaire_bonus", label: "anniversaire" });
  }
  if (event.kind === "member.achievement" && event.subjectId) {
    actions.push({ type: "grant", amount: 1000, reason: "succes_bonus", label: `succès ${event.payload?.key ?? ""}`.trim() });
    actions.push({ type: "clan", points: 25, label: "succès" });
  }
  if (event.kind === "quest.completed" && event.subjectId) {
    actions.push({ type: "clan", points: Number(event.payload?.points) || 15, label: "quête" });
  }
  return actions;
}

/** Applies one event's plan. Returns a short line per effect, for the audit log. */
export function applyPlan(event, now = Date.now()) {
  const applied = [];
  for (const action of planFor(event)) {
    if (action.type === "sanction") {
      for (const scope of action.scopes) {
        applySanction({ guildId: event.guildId, userId: event.subjectId, scope, durationMs: action.ms, reason: action.label, now });
      }
      applied.push(`gel ${action.scopes.join(", ")} (${action.label})`);
    } else if (action.type === "lift") {
      const lifted = action.scopes.filter((scope) => liftSanction(event.guildId, event.subjectId, scope));
      if (lifted.length) applied.push(`levée ${lifted.join(", ")}`);
    } else if (action.type === "retrust") {
      invalidateTrust(event.guildId, event.subjectId);
    } else if (action.type === "clan") {
      // Idempotent like a payout: a replay must not inflate a clan's standing.
      if (claim(event.id, `clan:${action.label}`, now)) {
        const points = addClanPoints(event.guildId, event.subjectId, action.points);
        if (points) applied.push(`+${points} pts de clan (${action.label})`);
      }
    } else if (action.type === "grant") {
      const paid = grantPnd({
        eventId: event.id, rule: action.reason, guildId: event.guildId, userId: event.subjectId,
        amount: action.amount, reason: action.reason, now,
      });
      if (paid) applied.push(`+${paid.toLocaleString("fr-FR")} PND (${action.label})`);
    }
  }
  return applied;
}

/**
 * One pass over the pending events. `onEffect` receives every applied effect so
 * the caller can mirror it into the audit channel.
 */
export async function runCascade({ guildIds = null, onEffect = () => {}, now = Date.now() } = {}) {
  let effects = 0;
  const result = await consumeEvents(CASCADE_CONSUMER, (event) => {
    for (const line of applyPlan(event, Date.now())) {
      effects += 1;
      onEffect(event, line);
    }
  }, { guildIds, limit: 100 });

  // A season that ran past its end date is closed here rather than by a
  // separate timer, so the podium lands on the bus like everything else.
  for (const season of dueSeasons(now)) {
    try {
      const { boards } = closeSeason({ guildId: season.guild_id, now });
      effects += 1;
      onEffect({ kind: "season.ended", guildId: season.guild_id }, `saison ${season.number} clôturée (${boards.clans.length} clan(s) au podium)`);
    } catch (error) {
      console.error("[cascade] clôture de saison impossible:", error?.message ?? "erreur");
    }
  }

  for (const lifted of expireSanctions(now)) {
    publishEventSafe({
      guildId: lifted.guildId, kind: "sanction.expired", subjectId: lifted.userId,
      payload: { scope: lifted.scope }, source: "cascade",
    });
    invalidateTrust(lifted.guildId, lifted.userId);
  }
  return { ...result, effects };
}

export const startCascade = () => initCursor(CASCADE_CONSUMER);
export { EVENT_KINDS };
