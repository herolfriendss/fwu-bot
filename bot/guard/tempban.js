// GUARD — ban temporaire (+tempban @membre durée [raison], /tempban).
// Le ban passe par le chemin commun des sanctions (hiérarchie, quota « ban », dossier,
// MP avec bouton d'appel) ; ce module retient seulement l'échéance et lève le ban à
// l'heure dite (minuterie de GUARD, reprise par le bot principal si GUARD est arrêté).
// Un débannissement manuel ou un appel accepté efface l'échéance.
import { db } from "../database.js";
import { parseDurationToSeconds } from "../shared/sanctions.js";

export const TEMPBAN_MIN_SECONDS = 60;
export const TEMPBAN_MAX_SECONDS = 365 * 86_400;

db.exec(`CREATE TABLE IF NOT EXISTS guard_tempbans (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
  case_id INTEGER, moderator_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
)`);

/** "7j", "12h", "1h30", "45" (minutes) → secondes, ou un message d'erreur. */
export function parseTempbanDuration(input) {
  const seconds = parseDurationToSeconds(input);
  if (!seconds) return { error: "Durée invalide : par exemple `30m`, `12h`, `7j` ou `1h30`." };
  if (seconds < TEMPBAN_MIN_SECONDS) return { error: "Durée trop courte : 1 minute au minimum." };
  if (seconds > TEMPBAN_MAX_SECONDS) return { error: "Durée trop longue : 365 jours au maximum (sinon utilise un ban définitif)." };
  return { seconds };
}

export function scheduleTempban({ guildId, userId, seconds, caseId = null, moderatorId, reason = "", now = Date.now() }) {
  const expiresAt = now + seconds * 1000;
  db.prepare(`INSERT INTO guard_tempbans(guild_id, user_id, expires_at, case_id, moderator_id, reason, created_at, attempts)
    VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(guild_id, user_id) DO UPDATE SET expires_at = excluded.expires_at,
    case_id = excluded.case_id, moderator_id = excluded.moderator_id, reason = excluded.reason, created_at = excluded.created_at, attempts = 0`)
    .run(String(guildId), String(userId), expiresAt, caseId, String(moderatorId), String(reason ?? "").slice(0, 300), now);
  return expiresAt;
}

export function getTempban(guildId, userId) {
  return db.prepare("SELECT * FROM guard_tempbans WHERE guild_id = ? AND user_id = ?").get(String(guildId), String(userId)) ?? null;
}

export function clearTempban(guildId, userId) {
  return db.prepare("DELETE FROM guard_tempbans WHERE guild_id = ? AND user_id = ?").run(String(guildId), String(userId)).changes > 0;
}

export function listTempbans(guildId) {
  return db.prepare("SELECT * FROM guard_tempbans WHERE guild_id = ? ORDER BY expires_at").all(String(guildId));
}

/**
 * Lève les bans arrivés à échéance. `guildFor(id)` rend le serveur (ou null s'il n'est
 * pas joignable : on réessaie plus tard). Après 5 échecs Discord, l'échéance est
 * abandonnée et signalée, pour ne pas réessayer sans fin.
 */
export async function expireTempbans({ guildFor, onLifted = () => {}, onFailed = () => {}, now = Date.now() } = {}) {
  const due = db.prepare("SELECT * FROM guard_tempbans WHERE expires_at <= ? ORDER BY expires_at LIMIT 50").all(now);
  let lifted = 0;
  for (const row of due) {
    const guild = guildFor(row.guild_id);
    if (!guild) continue;
    try {
      await guild.bans.remove(row.user_id, `Fin du ban temporaire${row.case_id ? ` (dossier #${row.case_id})` : ""}`);
      clearTempban(row.guild_id, row.user_id);
      lifted += 1;
      onLifted(guild, row);
    } catch (error) {
      const code = error?.code ?? error?.rawError?.code;
      // 10026 : déjà débanni à la main. L'échéance n'a plus d'objet.
      if (code === 10026) { clearTempban(row.guild_id, row.user_id); continue; }
      const attempts = Number(row.attempts) + 1;
      if (attempts >= 5) { clearTempban(row.guild_id, row.user_id); onFailed(guild, row); }
      else db.prepare("UPDATE guard_tempbans SET attempts = ?, expires_at = ? WHERE guild_id = ? AND user_id = ?").run(attempts, now + attempts * 60_000, row.guild_id, row.user_id);
    }
  }
  return lifted;
}
