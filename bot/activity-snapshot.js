// Instantané d'activité envoyé au site (POST /api/public/activity-snapshot) :
// classement XP, 30 derniers jours d'activité et chiffres des animations.
// Format fixé avec l'équipe du site le 25/11/2026 (equipe/format-instantane-activite.md).
//
// Borné et sans contenu : identifiants, nom affiché sur le serveur, compteurs.
// Jamais de texte de message, de pseudo de compte ni d'avatar.
import { db } from "./database.js";

export const ACTIVITY_TOP = 25;
export const ACTIVITY_DAYS = 30;
const DAY_MS = 86_400_000;

const clamp = (value, max) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};
const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

function cleanName(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Jours UTC (AAAA-MM-JJ), comme `analytics_daily.day_key`, du plus ancien au plus récent. */
export function activityDays(now = Date.now(), days = ACTIVITY_DAYS) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

function levelsEnabled(guildId) {
  if (!tableExists("community_level_config")) return false;
  const row = db.prepare("SELECT enabled FROM community_level_config WHERE guild_id=?").get(guildId);
  return row ? Boolean(row.enabled) : true;
}

function animationFigures(guildId) {
  const counting = tableExists("animation_counting")
    ? db.prepare("SELECT record, current FROM animation_counting WHERE guild_id=?").get(guildId) : null;
  const stars = tableExists("animation_starboard_posts")
    ? db.prepare("SELECT COUNT(*) AS n FROM animation_starboard_posts WHERE guild_id=? AND star_message_id IS NOT NULL").get(guildId) : null;
  const starConfig = tableExists("animation_starboard_config")
    ? db.prepare("SELECT 1 AS ok FROM animation_starboard_config WHERE guild_id=?").get(guildId) : null;
  const qotd = tableExists("animation_qotd_config")
    ? db.prepare("SELECT posted FROM animation_qotd_config WHERE guild_id=?").get(guildId) : null;
  if (!counting && !starConfig && !qotd) return null;
  return {
    countingRecord: clamp(counting?.record, 999_999_999),
    countingCurrent: clamp(counting?.current, 999_999_999),
    starboardPosts: clamp(stars?.n, 10_000_000),
    qotdPosted: clamp(qotd?.posted, 1_000_000),
  };
}

/** Pur côté Discord : `guild` sert seulement aux noms affichés (cache, aucun appel réseau). */
export function buildActivitySnapshot(guildId, guild = null, now = Date.now()) {
  const hasLevels = tableExists("community_levels");
  const ranked = hasLevels
    ? db.prepare("SELECT COUNT(*) AS n FROM community_levels WHERE guild_id=? AND xp>0").get(guildId) : { n: 0 };
  const top = hasLevels
    ? db.prepare(`SELECT user_id, xp, level, messages, voice_minutes FROM community_levels
        WHERE guild_id=? AND xp>0 ORDER BY xp DESC, user_id ASC LIMIT ?`).all(guildId, ACTIVITY_TOP) : [];

  const days = activityDays(now);
  const byDay = new Map(days.map((day) => [day, { day, messages: 0, joins: 0, leaves: 0 }]));
  if (tableExists("analytics_daily")) {
    const rows = db.prepare(`SELECT day_key, metric, metric_value FROM analytics_daily
      WHERE guild_id=? AND day_key>=? AND day_key<=? AND metric IN ('messages','joins','leaves')`).all(guildId, days[0], days[days.length - 1]);
    for (const row of rows) {
      const entry = byDay.get(row.day_key);
      if (entry) entry[row.metric] = Number(row.metric_value);
    }
  }
  // Un jour n'apparaît qu'une fois (exigence du site) ; un jour sans activité est absent.
  const daily = [...byDay.values()]
    .filter((d) => d.messages || d.joins || d.leaves)
    .map((d) => ({ day: d.day, messages: clamp(d.messages, 10_000_000), joins: clamp(d.joins, 1_000_000), leaves: clamp(d.leaves, 1_000_000) }));

  return {
    guildId,
    guildName: cleanName(guild?.name, 100),
    levelsEnabled: levelsEnabled(guildId),
    rankedMembers: clamp(ranked?.n, 10_000_000),
    topXp: top.map((row) => ({
      userId: row.user_id,
      displayName: cleanName(guild?.members?.cache?.get(row.user_id)?.displayName, 80),
      xp: clamp(row.xp, 1_000_000_000),
      level: clamp(row.level, 1_000),
      messages: clamp(row.messages, 1_000_000_000),
      voiceMinutes: clamp(row.voice_minutes, 100_000_000),
    })),
    daily,
    animation: animationFigures(guildId),
    capturedAt: new Date(now).toISOString(),
  };
}
