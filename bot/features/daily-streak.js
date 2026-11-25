// LE FISC — /daily streak: consecutive claims (each within 48 h of the previous one).
import { db } from "../database.js";

db.exec("CREATE TABLE IF NOT EXISTS daily_streaks (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, streak INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id));");

/** Updates and returns the new streak (1 when broken or first claim). */
export function nextDailyStreak(guildId, userId, previousClaimAt, now = Date.now()) {
  const row = db.prepare("SELECT streak, best FROM daily_streaks WHERE guild_id=? AND user_id=?").get(guildId, userId);
  const continued = previousClaimAt !== null && now - previousClaimAt <= 48 * 3_600_000;
  const streak = continued ? (row?.streak ?? 0) + 1 : 1;
  db.prepare("INSERT INTO daily_streaks(guild_id,user_id,streak,best) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET streak=excluded.streak, best=MAX(daily_streaks.best, excluded.streak)")
    .run(guildId, userId, streak, Math.max(streak, row?.best ?? 0));
  return streak;
}

export const dailyStreakReward = (base, streak) => Math.floor(base * (1 + Math.min(1, Math.max(0, streak - 1) * 0.1)));
