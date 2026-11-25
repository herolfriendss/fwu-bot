// FWU — purge quotidienne des journaux de la base centrale (proposition n°10).
// quota_usage : 31 jours (la plus longue fenêtre de quota possible est 30 jours).
// command_usage : 90 jours. Les sanctions, dépassements et modifications de
// configuration ne sont JAMAIS purgés : ce sont des preuves.
import { sharedDbAvailable, sharedQuery } from "./db.js";

export const RETENTION_DAYS = Object.freeze({ quota_usage: 31, command_usage: 90 });
const DAY_MS = 24 * 60 * 60_000;

/** Supprime les lignes trop vieilles. Renvoie le nombre supprimé par table. */
export async function purgeOldUsage() {
  const quota = await sharedQuery("DELETE FROM quota_usage WHERE used_at < now() - make_interval(days => $1)", [RETENTION_DAYS.quota_usage]);
  const commands = await sharedQuery("DELETE FROM command_usage WHERE created_at < now() - make_interval(days => $1)", [RETENTION_DAYS.command_usage]);
  return { quota_usage: Number(quota.rowCount ?? 0), command_usage: Number(commands.rowCount ?? 0) };
}

/** Une fois par jour (premier passage 10 min après le démarrage), seulement si `shouldRun()` (FWU). */
export function startUsageRetention({ record = () => {}, shouldRun = () => true, firstDelayMs = 10 * 60_000 } = {}) {
  const run = async () => {
    if (!shouldRun() || !sharedDbAvailable()) return;
    try {
      const removed = await purgeOldUsage();
      if (removed.quota_usage || removed.command_usage) record("shared_db_purged");
    } catch {
      record("shared_db_purge_error");
    }
  };
  const first = setTimeout(() => { void run(); setInterval(() => { void run(); }, DAY_MS).unref?.(); }, firstDelayMs);
  first.unref?.();
  return run;
}
