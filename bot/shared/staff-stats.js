// FWU — chiffres du staff lus dans la base centrale (idée SYS+ n°5). Lecture seule.
import { sharedQuery } from "./db.js";

/** Sanctions par modérateur et par type, commandes utilisées, refus de quota, sur `days` jours. */
export async function loadCentralStaffActivity(guildId, days) {
  const params = [guildId, days];
  const [sanctions, usage, violations] = await Promise.all([
    sharedQuery(`SELECT moderator_id, action, count(*)::int AS n, max(created_at) AS last FROM sanctions
      WHERE guild_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY moderator_id, action`, params),
    sharedQuery(`SELECT user_id, count(*)::int AS n, max(created_at) AS last FROM command_usage
      WHERE guild_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY user_id`, params),
    sharedQuery(`SELECT user_id, count(*)::int AS n FROM quota_violations
      WHERE guild_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY user_id`, params),
  ]);
  return {
    sanctions: sanctions.rows.map((r) => ({ userId: r.moderator_id, action: r.action, count: Number(r.n), last: new Date(r.last).getTime() })),
    usage: usage.rows.map((r) => ({ userId: r.user_id, count: Number(r.n), last: new Date(r.last).getTime() })),
    violations: violations.rows.map((r) => ({ userId: r.user_id, count: Number(r.n) })),
  };
}
