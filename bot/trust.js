// Shared trust score: one number, computed from what the five bots already
// know, that every bot reads before letting a member do something risky.
//
// It is not a punishment — it decides how much rope a member gets: casino
// stakes, economy ceilings, DJ control, voice access. A fresh or sanctioned
// account is limited everywhere at once, and earns its way back automatically.
import { db } from "./database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS fwu_trust (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL, tier TEXT NOT NULL,
    reasons_json TEXT NOT NULL, computed_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS fwu_sanctions (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, scope TEXT NOT NULL,
    until INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, scope)
  );
`);

const DAY = 86_400_000;
export const CACHE_MS = 10 * 60_000;

export const TRUST_TIERS = Object.freeze([
  { key: "risque", label: "À risque", emoji: "🚫", from: 0, betFactor: 0, dj: false, economy: false },
  { key: "surveille", label: "Sous surveillance", emoji: "⚠️", from: 20, betFactor: 0.25, dj: false, economy: true },
  { key: "normal", label: "Normal", emoji: "🙂", from: 40, betFactor: 1, dj: true, economy: true },
  { key: "confirme", label: "Confirmé", emoji: "✅", from: 65, betFactor: 2, dj: true, economy: true },
  { key: "veteran", label: "Vétéran", emoji: "🏅", from: 85, betFactor: 3, dj: true, economy: true },
]);

export function tierForScore(score) {
  let tier = TRUST_TIERS[0];
  for (const candidate of TRUST_TIERS) if (score >= candidate.from) tier = candidate;
  return tier;
}

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Pure scoring. Every contribution is reported so a member can be told why,
 * and so a moderator can argue with the number instead of guessing it.
 */
export function computeTrust(signals = {}) {
  const {
    accountAgeMs = 0, memberForMs = 0, level = 0, messages = 0, voiceMinutes = 0,
    activeWarnings = 0, recentCases = [], quarantined = false, hasAvatar = true, bot = false,
  } = signals;
  const reasons = [];
  let score = 50;
  const add = (points, label) => {
    if (!points) return;
    score += points;
    reasons.push({ points: Math.round(points), label });
  };

  if (bot) return { score: 100, tier: tierForScore(100), reasons: [{ points: 0, label: "Application Discord" }] };

  const ageDays = accountAgeMs / DAY;
  if (ageDays < 7) add(-25, "Compte créé il y a moins d'une semaine");
  else if (ageDays < 30) add(-10, "Compte de moins d'un mois");
  else add(Math.min(20, Math.round(ageDays / 30)), "Ancienneté du compte Discord");

  const memberDays = memberForMs / DAY;
  if (memberDays >= 1) add(Math.min(15, Math.round(memberDays / 12)), "Ancienneté sur le serveur");

  add(Math.min(10, Math.floor(level / 3)), "Niveau atteint");
  add(Math.min(8, Math.floor(messages / 200)), "Messages envoyés");
  add(Math.min(7, Math.floor(voiceMinutes / 300)), "Temps passé en vocal");

  if (!hasAvatar) add(-5, "Aucune photo de profil");
  if (activeWarnings) add(-8 * activeWarnings, `${activeWarnings} avertissement(s) en cours`);

  const weights = { ban: -25, kick: -12, mute: -6, warn: -4, quarantine: -10 };
  const penalty = recentCases.reduce((sum, action) => sum + (weights[action] ?? -3), 0);
  if (penalty) add(penalty, "Sanctions des 30 derniers jours");
  if (quarantined) add(-30, "Actuellement en quarantaine");

  const final = clamp(score);
  return { score: final, tier: tierForScore(final), reasons };
}

/**
 * Each bot loads a different set of modules, so a table this reads may not
 * exist in the process asking (GUARD never creates the level tables). A
 * missing table means "no signal", never a crash.
 */
const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

/** Reads every signal the bots share about one member. */
export function trustSignals(guildId, userId, member = null, now = Date.now()) {
  const level = (tableExists("community_levels")
    && db.prepare("SELECT level, messages, voice_minutes FROM community_levels WHERE guild_id=? AND user_id=?").get(guildId, userId))
    || { level: 0, messages: 0, voice_minutes: 0 };
  const activeWarnings = tableExists("moderation_warnings")
    ? Number(db.prepare(`SELECT COUNT(*) AS n FROM moderation_warnings
        WHERE guild_id=? AND user_id=? AND (expires_at IS NULL OR expires_at>?)`).get(guildId, userId, now).n)
    : 0;
  const recentCases = tableExists("moderation_cases")
    ? db.prepare("SELECT action FROM moderation_cases WHERE guild_id=? AND user_id=? AND created_at>?")
      .all(guildId, userId, now - 30 * DAY).map((row) => String(row.action).toLowerCase())
    : [];
  const quarantined = tableExists("guard_quarantine")
    && Boolean(db.prepare("SELECT 1 FROM guard_quarantine WHERE guild_id=? AND user_id=?").get(guildId, userId));
  return {
    accountAgeMs: member?.user?.createdTimestamp ? now - member.user.createdTimestamp : 0,
    memberForMs: member?.joinedTimestamp ? now - member.joinedTimestamp : 0,
    level: Number(level.level), messages: Number(level.messages), voiceMinutes: Number(level.voice_minutes),
    activeWarnings, recentCases, quarantined,
    hasAvatar: member ? Boolean(member.user?.avatar) : true,
    bot: Boolean(member?.user?.bot),
  };
}

const store = (guildId, userId, result, now) =>
  db.prepare(`INSERT INTO fwu_trust(guild_id,user_id,score,tier,reasons_json,computed_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET score=excluded.score, tier=excluded.tier,
    reasons_json=excluded.reasons_json, computed_at=excluded.computed_at`)
    .run(guildId, userId, result.score, result.tier.key, JSON.stringify(result.reasons), now);

/** Cached score. Pass a member to recompute from Discord-side signals. */
export function trustFor(guildId, userId, member = null, now = Date.now()) {
  const cached = db.prepare("SELECT score,tier,reasons_json,computed_at FROM fwu_trust WHERE guild_id=? AND user_id=?")
    .get(guildId, userId);
  if (cached && now - Number(cached.computed_at) < CACHE_MS && !member) {
    return { score: Number(cached.score), tier: tierForScore(Number(cached.score)), reasons: JSON.parse(cached.reasons_json), cached: true };
  }
  const result = computeTrust(trustSignals(guildId, userId, member, now));
  store(guildId, userId, result, now);
  return { ...result, cached: false };
}

export const invalidateTrust = (guildId, userId) =>
  db.prepare("DELETE FROM fwu_trust WHERE guild_id=? AND user_id=?").run(guildId, userId);

// ------------------------------------------------------------- sanctions ----

export const SANCTION_SCOPES = Object.freeze(["casino", "economie", "dj", "vocal", "social"]);

/** A moderation action freezes one capability for a while, across every bot. */
export function applySanction({ guildId, userId, scope, durationMs, reason = null, now = Date.now() }) {
  if (!SANCTION_SCOPES.includes(scope)) throw new Error(`Domaine de sanction inconnu : ${scope}`);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Durée de sanction invalide.");
  const until = now + durationMs;
  db.prepare(`INSERT INTO fwu_sanctions(guild_id,user_id,scope,until,reason,created_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(guild_id,user_id,scope) DO UPDATE SET
    until=MAX(fwu_sanctions.until,excluded.until), reason=excluded.reason`)
    .run(guildId, userId, scope, until, reason, now);
  return until;
}

export const liftSanction = (guildId, userId, scope) =>
  Number(db.prepare("DELETE FROM fwu_sanctions WHERE guild_id=? AND user_id=? AND scope=?").run(guildId, userId, scope).changes);

export function sanctionUntil(guildId, userId, scope, now = Date.now()) {
  const row = db.prepare("SELECT until FROM fwu_sanctions WHERE guild_id=? AND user_id=? AND scope=? AND until>?")
    .get(guildId, userId, scope, now);
  return row ? Number(row.until) : null;
}

export const activeSanctions = (guildId, userId, now = Date.now()) =>
  db.prepare("SELECT scope,until,reason FROM fwu_sanctions WHERE guild_id=? AND user_id=? AND until>? ORDER BY until DESC")
    .all(guildId, userId, now)
    .map((row) => ({ scope: row.scope, until: Number(row.until), reason: row.reason }));

/** Returns the sanctions that just ran out, so the bus can announce the lift. */
export function expireSanctions(now = Date.now()) {
  const done = db.prepare("SELECT guild_id,user_id,scope FROM fwu_sanctions WHERE until<=?").all(now)
    .map((row) => ({ guildId: row.guild_id, userId: row.user_id, scope: row.scope }));
  if (done.length) db.prepare("DELETE FROM fwu_sanctions WHERE until<=?").run(now);
  return done;
}

/**
 * The single question the other bots ask: may this member do X, and how far?
 * `maxBet` is null when there is no ceiling beyond the game's own limits.
 */
export function permissionFor(guildId, userId, scope, { member = null, baseBet = 100_000, now = Date.now() } = {}) {
  const frozen = sanctionUntil(guildId, userId, scope, now);
  const trust = trustFor(guildId, userId, member, now);
  if (frozen) {
    return { allowed: false, until: frozen, trust, reason: `Accès suspendu jusqu'au <t:${Math.floor(frozen / 1000)}:F>.` };
  }
  if (scope === "casino" && !trust.tier.betFactor) {
    return { allowed: false, until: null, trust, reason: "Ton score de confiance est trop bas pour miser. Participe au serveur pour le faire remonter." };
  }
  if (scope === "dj" && !trust.tier.dj) {
    return { allowed: false, until: null, trust, reason: "Le contrôle DJ demande un score de confiance plus élevé." };
  }
  if (scope === "economie" && !trust.tier.economy) {
    return { allowed: false, until: null, trust, reason: "Ton score de confiance est trop bas pour l'économie." };
  }
  const maxBet = scope === "casino" ? Math.floor(baseBet * trust.tier.betFactor) : null;
  return { allowed: true, until: null, trust, maxBet, reason: null };
}
