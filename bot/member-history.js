// Historique des sanctions unifié (prérequis de la fiche membre, idée SYS+ n°7).
//
// Deux sources existaient côte à côte :
//  • la base centrale (table `sanctions`) : tous les bots, mais sans numéro d'affaire ;
//  • le casier local (`moderation_cases`, et les archives `moderation_cases_removed`) :
//    numéro d'affaire, appels, retraits, mais seulement pour ce bot.
// Une même sanction est écrite dans les deux. On les rapproche (même modérateur, même
// action, à 15 s près) pour n'afficher qu'une ligne, avec le numéro d'affaire s'il existe.
// Une affaire retirée du casier reste visible, barrée : c'est une preuve.
import { db } from "./database.js";
import { listMemberSanctions } from "./shared/sanctions.js";
import { formatDurationFr } from "./shared/quotas.js";

export const MATCH_WINDOW_MS = 15_000;
const CENTRAL_TO_CASE = Object.freeze({ tempmute: "mute" });

export const HISTORY_LABELS = Object.freeze({
  warn: "Avertissement", mute: "Exclusion", unmute: "Fin d'exclusion", kick: "Expulsion", ban: "Bannissement",
  unban: "Débannissement", blacklist: "Blacklist", quarantine: "Quarantaine", unquarantine: "Fin de quarantaine",
});

const caseAction = (action) => CENTRAL_TO_CASE[action] ?? action;

/**
 * Fusion pure. central : lignes de listMemberSanctions ; cases / removed : lignes locales
 * ({ id, action, reason, moderatorId, createdAt, removedBy?, removalReason?, removedAt? }).
 * Renvoie les entrées du plus récent au plus ancien.
 */
export function mergeMemberHistory(central = [], cases = [], removed = []) {
  const local = [
    ...cases.map((c) => ({ ...c, removed: false })),
    ...removed.map((c) => ({ ...c, removed: true })),
  ].map((c) => ({ ...c, used: false }));
  const entries = [];
  for (const item of central) {
    const at = item.createdAt instanceof Date ? item.createdAt.getTime() : Number(item.createdAt);
    const match = local.find((c) => !c.used && c.moderatorId === item.moderatorId && c.action === caseAction(item.action)
      && Math.abs(Number(c.createdAt) - at) <= MATCH_WINDOW_MS);
    if (match) match.used = true;
    entries.push({
      action: caseAction(item.action), label: item.label ?? null, reason: item.reason || match?.reason || "",
      moderatorId: item.moderatorId, createdAt: at, durationSeconds: item.durationSeconds ?? null, bot: item.bot ?? null,
      caseId: match?.id ?? null, removed: Boolean(match?.removed), removedBy: match?.removedBy ?? null,
      removalReason: match?.removalReason ?? null, source: match ? "both" : "central",
    });
  }
  for (const c of local.filter((x) => !x.used)) {
    entries.push({
      action: c.action, label: null, reason: c.reason ?? "", moderatorId: c.moderatorId, createdAt: Number(c.createdAt),
      durationSeconds: c.durationSeconds ?? null, bot: null, caseId: c.id, removed: c.removed,
      removedBy: c.removedBy ?? null, removalReason: c.removalReason ?? null, source: "local",
    });
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

function localCases(guildId, userId, limit) {
  const cases = db.prepare("SELECT id, action, reason, moderator_id, details_json, created_at FROM moderation_cases WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?")
    .all(guildId, userId, limit).map((row) => {
      let details = {};
      try { details = JSON.parse(row.details_json || "{}") ?? {}; } catch { details = {}; }
      return { id: Number(row.id), action: row.action, reason: row.reason, moderatorId: row.moderator_id, createdAt: Number(row.created_at), durationSeconds: Number(details.durationSeconds) || null };
    });
  let removed = [];
  try {
    removed = db.prepare("SELECT id, action, reason, moderator_id, created_at, removed_by, removal_reason, removed_at FROM moderation_cases_removed WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, limit).map((row) => ({
        id: Number(row.id), action: row.action, reason: row.reason, moderatorId: row.moderator_id, createdAt: Number(row.created_at),
        removedBy: row.removed_by, removalReason: row.removal_reason, removedAt: Number(row.removed_at),
      }));
  } catch { /* table créée par GUARD au premier chargement */ }
  return { cases, removed };
}

/**
 * Historique complet d'un membre. Si la base centrale est injoignable, on montre au moins
 * le casier local et `centralAvailable` vaut false (l'affichage le signale).
 */
export async function loadMemberHistory({ guildId, userId, limit = 50, loadCentral = listMemberSanctions }) {
  const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
  let central = [];
  let centralTotal = 0;
  let centralAvailable = true;
  try {
    const result = await loadCentral(guildId, userId, { limit: size, offset: 0 });
    central = result.items;
    centralTotal = result.total;
  } catch {
    centralAvailable = false;
  }
  const { cases, removed } = localCases(guildId, userId, size);
  const entries = mergeMemberHistory(central, cases, removed);
  return { entries, centralAvailable, total: Math.max(centralTotal, entries.length) };
}

export function formatHistoryEntry(entry) {
  const date = `<t:${Math.floor(entry.createdAt / 1000)}:d>`;
  const name = HISTORY_LABELS[entry.action] ?? String(entry.action).replace(/_/g, " ");
  const head = `${entry.caseId ? `#${entry.caseId} · ` : ""}${name}${entry.label ? ` (${entry.label})` : ""}${entry.durationSeconds ? ` · ${formatDurationFr(entry.durationSeconds)}` : ""}`;
  const by = `par <@${entry.moderatorId}>${entry.bot ? ` · ${entry.bot}` : ""}`;
  const reason = entry.reason ? `\n↳ ${String(entry.reason).slice(0, 140)}` : "";
  if (entry.removed) {
    return `~~${head}~~ · ${date} · ${by} · **retirée** par <@${entry.removedBy}> : ${String(entry.removalReason ?? "").slice(0, 100)}`;
  }
  return `**${head}** · ${date} · ${by}${reason}`;
}

/** Compte par type, sans les affaires retirées ni les levées. */
export function summarizeHistory(entries) {
  const counts = {};
  for (const e of entries) {
    if (e.removed || e.action === "unmute" || e.action === "unban" || e.action === "unquarantine") continue;
    counts[e.action] = (counts[e.action] ?? 0) + 1;
  }
  return counts;
}
