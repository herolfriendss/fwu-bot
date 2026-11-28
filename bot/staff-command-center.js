// STAFF CENTER (SUCK ME) — /staff centre : tableau de commandement (tâche 1.6).
//
// Un seul écran pour le staff : qui est joignable, dossiers d'intervention, validations en
// attente, tickets ouverts, signalements Guardian à revoir, contestations, missions en retard,
// prochaines réunions et état des bots. Lecture seule ; chaque section lit sa propre table et
// une table absente (module jamais utilisé) affiche « — » au lieu de faire échouer l'écran.
// Réservé au staff (données sensibles) ; aucune donnée d'un autre serveur.
import { db as defaultDb } from "./database.js";
import { interventionCounts, listInterventions, staleInterventions } from "./staff-interventions.js";
import { listMeetings, overdueMissions } from "./staff-missions.js";
import { reachableStaff } from "./staff-availability.js";
import { queueStats } from "./core-queue.js";

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

/** Pure data gathering; `absentIds` from /staff absence, `staffIds` from the ladder. */
export function commandCenterData(guildId, { staffIds = [], absentIds = new Set(), db = defaultDb, now = Date.now(), profiles = [] } = {}) {
  const g = String(guildId);
  const count = (sql, ...args) => safe(() => Number(db.prepare(sql).get(...args)?.n ?? 0));
  return {
    reach: safe(() => reachableStaff(g, staffIds, { absentIds, db, now }), { onCall: [], available: [], declaredNone: [] }),
    absent: absentIds.size,
    interventions: safe(() => interventionCounts(g, { db }), {}),
    urgent: safe(() => listInterventions(g, { db, limit: 5 }).filter((r) => r.priority === "haute"), []),
    stale: safe(() => staleInterventions({ db, now }).filter((r) => r.guild_id === g), []),
    tickets: count("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'", g),
    unclaimedTickets: count("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open' AND claimed_by IS NULL", g),
    guardian: count("SELECT COUNT(*) AS n FROM guardian_review_queue WHERE guild_id = ? AND status = 'pending'", g),
    appeals: count("SELECT COUNT(*) AS n FROM moderation_appeals WHERE guild_id = ? AND status = 'pending'", g),
    overdue: safe(() => overdueMissions(g, { db, now }), []),
    meetings: safe(() => listMeetings(g, { db, now, limit: 2 }), []),
    bots: safe(() => botStates(db, now, profiles), []),
    authorityPending: count("SELECT COUNT(*) AS n FROM authority_requests WHERE guild_id = ? AND status = 'pending'", g),
    authorityActive: count("SELECT COUNT(*) AS n FROM authority_requests WHERE guild_id = ? AND status = 'active' AND expires_at > ?", g, now),
    deadJobs: safe(() => queueStats({ db, guildId: g }).filter((r) => r.status === "dead").reduce((n, r) => n + r.count, 0), 0),
  };
}

/** Bot states from the shared tables (leases, definitive stops, deliberate waits). */
export function botStates(db, now, profiles) {
  const leases = new Map(safe(() => db.prepare("SELECT domain, expires_at FROM bot_domain_leases").all(), []).map((r) => [r.domain, Number(r.expires_at) > now]));
  const stopped = new Set(safe(() => db.prepare("SELECT profile FROM bot_gateway_failures WHERE stopped = 1").all(), []).map((r) => r.profile));
  const waiting = new Set(safe(() => db.prepare("SELECT profile FROM bot_gateway_waits WHERE until > ?").all(now), []).map((r) => r.profile));
  return profiles.map(({ id, label, optional }) => ({
    id, label,
    state: leases.get(id) ? "online" : stopped.has(id) ? "stopped" : waiting.has(id) ? "waiting" : leases.has(id) ? "down" : optional ? "absent" : "down",
  }));
}

const ICON = { online: "🟢", waiting: "⏳", stopped: "⛔", down: "🔴", absent: "⚪" };
const v = (n) => (n === null || n === undefined ? "—" : String(n));
const users = (ids, max = 8) => (ids.length ? `${ids.slice(0, max).map((id) => `<@${id}>`).join(", ")}${ids.length > max ? ` +${ids.length - max}` : ""}` : "—");

export function formatCommandCenter(d) {
  const open = (d.interventions.open ?? 0) + (d.interventions.assigned ?? 0);
  const lines = [
    "🛰️ **Centre de commandement du staff**",
    "",
    "**👥 Staff**",
    `🟢 D'astreinte : ${users(d.reach.onCall)}`,
    `🗓️ Disponibles maintenant : ${users(d.reach.available)}`,
    `🌙 Absents : ${d.absent}${d.reach.declaredNone.length ? ` · ❔ sans créneaux : ${d.reach.declaredNone.length}` : ""}`,
    "",
    "**📂 Dossiers et demandes**",
    `Interventions ouvertes : ${open}${d.urgent.length ? ` (🔴 ${d.urgent.map((r) => `n°${r.number}`).join(", ")})` : ""} · à valider : ${d.interventions.pending ?? 0}`,
    d.stale.length ? `⚠️ Sans nouvelle depuis 48 h : ${d.stale.slice(0, 6).map((r) => `n°${r.number}${r.assignee_id ? ` (<@${r.assignee_id}>)` : ""}`).join(", ")}` : null,
    `🎫 Tickets ouverts : ${v(d.tickets)}${d.unclaimedTickets ? ` (dont ${d.unclaimedTickets} sans prise en charge)` : ""}`,
    `🛡️ Signalements Guardian à revoir : ${v(d.guardian)} · ⚖️ Contestations en attente : ${v(d.appeals)}`,
    `🔐 Dérogations AUTHORITY : ${v(d.authorityPending)} en attente de l'OWNER · ${v(d.authorityActive)} actives`,
    "",
    "**🎯 Organisation**",
    `Missions en retard : ${d.overdue.length ? d.overdue.slice(0, 5).map((m) => `n°${m.number}${m.assignee_id ? ` (<@${m.assignee_id}>)` : ""}`).join(", ") : "aucune"}`,
    `Prochaines réunions : ${d.meetings.length ? d.meetings.map((m) => `n°${m.number} ${m.topic} <t:${Math.floor(m.starts_at / 1000)}:R>`).join(" · ") : "aucune"}`,
  ];
  if (d.bots.length) lines.push("", "**🤖 Bots**", d.bots.filter((b) => b.state !== "absent").map((b) => `${ICON[b.state]} ${b.label}`).join(" · "));
  if (d.deadJobs) lines.push(`⚠️ Tâches entre bots en échec définitif : ${d.deadJobs} (à examiner par l'OWNER)`);
  return lines.filter((line) => line !== null).join("\n").slice(0, 1950);
}
