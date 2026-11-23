import { randomUUID } from "node:crypto";
import { db, transaction } from "../../database.js";

const SNOWFLAKE = /^\d{5,25}$/;
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const STATUSES = new Set(["open", "in_progress", "resolved"]);

function assertGuild(guildId) { if (typeof guildId !== "string" || !SNOWFLAKE.test(guildId)) throw new Error("Serveur invalide."); }
function assertUser(userId) { if (typeof userId !== "string" || !SNOWFLAKE.test(userId)) throw new Error("Membre invalide."); }
function authorized(guildId, actorId, action, callback) {
  assertGuild(guildId); assertUser(actorId);
  if (typeof callback !== "function" || callback({ guildId, actorId, action }) !== true) throw new Error("Action réservée au staff SYS+ autorisé.");
}

export function createSysPlusIncident(guildId, actorId, { title, summary, severity = "medium" }, { authorizeActor, now = Date.now() } = {}) {
  authorized(guildId, actorId, "incident.create", authorizeActor);
  const safeTitle = String(title ?? "").replace(/@/g, "＠").trim();
  const safeSummary = String(summary ?? "").replace(/@/g, "＠").trim();
  if (safeTitle.length < 5 || safeTitle.length > 100) throw new Error("Le titre doit contenir entre 5 et 100 caractères.");
  if (safeSummary.length < 5 || safeSummary.length > 1500) throw new Error("Le résumé doit contenir entre 5 et 1 500 caractères.");
  if (!SEVERITIES.has(severity)) throw new Error("Gravité d'incident invalide.");
  const incidentId = randomUUID();
  db.prepare(`INSERT INTO sysplus_incidents(incident_id,guild_id,title,summary,severity,status,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,'open',?,?,?)`).run(incidentId, guildId, safeTitle, safeSummary, severity, actorId, now, now);
  return getSysPlusIncident(guildId, incidentId);
}

export function getSysPlusIncident(guildId, incidentId) {
  assertGuild(guildId);
  const row = db.prepare("SELECT * FROM sysplus_incidents WHERE guild_id=? AND incident_id=?").get(guildId, incidentId);
  return row ? mapIncident(row) : null;
}

export function listSysPlusIncidents(guildId, { status = "open", limit = 30 } = {}) {
  assertGuild(guildId);
  if (!new Set([...STATUSES, "all"]).has(status)) throw new Error("Filtre d'incident invalide.");
  const bounded = Math.max(1, Math.min(50, Number(limit) || 30));
  return db.prepare("SELECT * FROM sysplus_incidents WHERE guild_id=? AND (?='all' OR status=?) ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,updated_at DESC LIMIT ?")
    .all(guildId, status, status, bounded).map(mapIncident);
}

export function assignSysPlusIncident(guildId, incidentId, actorId, assigneeId, { authorizeActor, now = Date.now() } = {}) {
  authorized(guildId, actorId, "incident.assign", authorizeActor); assertUser(assigneeId);
  const changed = db.prepare("UPDATE sysplus_incidents SET assigned_to=?,status=CASE WHEN status='open' THEN 'in_progress' ELSE status END,updated_at=? WHERE guild_id=? AND incident_id=? AND status!='resolved'")
    .run(assigneeId, now, guildId, incidentId);
  if (!Number(changed.changes)) throw new Error("Incident introuvable ou déjà résolu.");
  return getSysPlusIncident(guildId, incidentId);
}

export function updateSysPlusIncidentStatus(guildId, incidentId, actorId, status, { authorizeActor, now = Date.now() } = {}) {
  authorized(guildId, actorId, "incident.status", authorizeActor);
  if (!new Set(["open", "in_progress"]).has(status)) throw new Error("Utilise la commande de résolution pour clôturer un incident.");
  const changed = db.prepare("UPDATE sysplus_incidents SET status=?,updated_at=? WHERE guild_id=? AND incident_id=? AND status!='resolved'")
    .run(status, now, guildId, incidentId);
  if (!Number(changed.changes)) throw new Error("Incident introuvable.");
  return getSysPlusIncident(guildId, incidentId);
}

export function resolveSysPlusIncident(guildId, incidentId, actorId, resolution, { authorizeActor, now = Date.now() } = {}) {
  authorized(guildId, actorId, "incident.resolve", authorizeActor);
  const safeResolution = String(resolution ?? "").replace(/@/g, "＠").trim();
  if (safeResolution.length < 3 || safeResolution.length > 1500) throw new Error("La résolution doit contenir entre 3 et 1 500 caractères.");
  const changed = db.prepare("UPDATE sysplus_incidents SET status='resolved',resolution=?,resolved_by=?,resolved_at=?,updated_at=? WHERE guild_id=? AND incident_id=? AND status!='resolved'")
    .run(safeResolution, actorId, now, now, guildId, incidentId);
  if (!Number(changed.changes)) throw new Error("Incident introuvable ou déjà résolu.");
  return getSysPlusIncident(guildId, incidentId);
}

function mapIncident(row) {
  return { incidentId: row.incident_id, guildId: row.guild_id, title: row.title, summary: row.summary, severity: row.severity, status: row.status, createdBy: row.created_by, assignedTo: row.assigned_to, resolvedBy: row.resolved_by, resolution: row.resolution, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at) };
}

/**
 * Incident report (Markdown): incident card plus the SYS+ audit timeline
 * between creation and resolution (or now). Read-only; bounded to 200 rows.
 */
export function buildSysPlusIncidentReport(guildId, incidentId, { now = Date.now() } = {}) {
  const incident = getSysPlusIncident(guildId, incidentId);
  if (!incident) throw new Error("Incident introuvable.");
  const end = incident.resolvedAt ?? now;
  const rows = db.prepare("SELECT actor_id,action,target_id,created_at FROM sysplus_audit WHERE guild_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at ASC LIMIT 200")
    .all(guildId, incident.createdAt, end);
  const iso = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const severity = { low: "Faible", medium: "Moyenne", high: "Élevée", critical: "Critique" }[incident.severity] ?? incident.severity;
  const status = { open: "Ouvert", in_progress: "En cours", resolved: "Résolu" }[incident.status] ?? incident.status;
  const minutes = Math.round((end - incident.createdAt) / 60_000);
  return [
    `# Rapport d'incident — ${incident.title}`,
    "",
    `- Référence : \`${incident.incidentId}\``,
    `- Gravité : ${severity} · Statut : ${status}`,
    `- Ouvert le : ${iso(incident.createdAt)} par ${incident.createdBy}`,
    `- Responsable : ${incident.assignedTo ?? "non assigné"}`,
    incident.resolvedAt ? `- Résolu le : ${iso(incident.resolvedAt)} par ${incident.resolvedBy} (durée ${minutes} min)` : `- En cours depuis ${minutes} min`,
    "",
    "## Résumé",
    incident.summary,
    "",
    "## Résolution",
    incident.resolution ?? "_Non résolu._",
    "",
    `## Chronologie des actions auditées (${rows.length}${rows.length === 200 ? ", tronquée" : ""})`,
    ...(rows.length ? rows.map((row) => `- ${iso(Number(row.created_at))} · \`${row.action}\` · acteur ${row.actor_id}${row.target_id ? ` · cible ${row.target_id}` : ""}`) : ["_Aucune action auditée pendant cette période._"]),
    "",
    "_Rapport généré par FWU. Identifiants Discord bruts, aucun contenu de message._",
  ].join("\n");
}
