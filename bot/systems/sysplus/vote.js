// SYS+ — vote des membres SYS+ sur un candidat (/sysp vote). Les SYS+ donnent leur avis (pour ou contre, une voix chacun,
// modifiable) ; l'owner voit le résultat et décide avec /sysp add. Un vote n'attribue jamais SYS+ tout seul. Valable 14 jours.
import { db } from "../../database.js";

export const SYSP_VOTE = Object.freeze({ ttlMs: 14 * 86_400_000 });

db.exec("CREATE TABLE IF NOT EXISTS sysplus_votes (guild_id TEXT NOT NULL, candidate_id TEXT NOT NULL, voter_id TEXT NOT NULL, pour INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, candidate_id, voter_id))");

export function castVote({ guildId, candidateId, voterId, pour = true, candidateIsBot = false, candidateIsSysPlus = false }, now = Date.now()) {
  if (candidateId === voterId) throw new Error("Tu ne peux pas voter pour toi-même.");
  if (candidateIsBot) throw new Error("Un bot ne peut pas être candidat.");
  if (candidateIsSysPlus) throw new Error("Ce membre a déjà SYS+.");
  db.prepare("DELETE FROM sysplus_votes WHERE at<?").run(now - SYSP_VOTE.ttlMs);
  db.prepare("INSERT OR REPLACE INTO sysplus_votes(guild_id,candidate_id,voter_id,pour,at) VALUES(?,?,?,?,?)").run(guildId, candidateId, voterId, pour ? 1 : 0, now);
  return tally(guildId, candidateId, now);
}

export function tally(guildId, candidateId, now = Date.now()) {
  const rows = db.prepare("SELECT pour FROM sysplus_votes WHERE guild_id=? AND candidate_id=? AND at>=?").all(guildId, candidateId, now - SYSP_VOTE.ttlMs);
  const pour = rows.filter((r) => r.pour).length;
  return { pour, contre: rows.length - pour, total: rows.length };
}

export const formatTally = (candidateId, t) => `🗳️ Vote SYS+ pour <@${candidateId}> : **${t.pour}** pour, **${t.contre}** contre (${t.total} voix). L'owner décide avec \`/sysp add\` ; un vote n'attribue rien tout seul.`;
