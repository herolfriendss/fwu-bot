// SYS+ — incidents ouverts tout seuls par GUARD (idée S5 de l'Éclaireur).
//
// Quand l'anti-nuke bloque une attaque ou qu'un verrouillage total démarre, un incident
// SYS+ est créé au nom du bot. Plusieurs alertes rapprochées (30 min) rejoignent le même
// incident au lieu d'en créer des doublons. Au déverrouillage, l'incident est résolu avec
// un résumé. Aucun droit n'est donné ni retiré ici.
import { db } from "../../database.js";
import { createSysPlusIncident, getSysPlusIncident, resolveSysPlusIncident } from "./incidents.js";

export const AUTO_PREFIX = "[Auto GUARD]";
export const MERGE_WINDOW_MS = 30 * 60_000;
const SYSTEM = () => true; // le bot agit lui-même : pas de membre à autoriser

function openAutoIncident(guildId, now) {
  return db.prepare(`SELECT incident_id FROM sysplus_incidents
    WHERE guild_id = ? AND status != 'resolved' AND title LIKE ? AND updated_at >= ?
    ORDER BY updated_at DESC LIMIT 1`).get(guildId, `${AUTO_PREFIX}%`, now - MERGE_WINDOW_MS)?.incident_id ?? null;
}

/**
 * Ouvre (ou complète) l'incident automatique du serveur.
 * Renvoie { incident, created } ; ne jette jamais pour ne pas gêner la défense du serveur.
 */
export function recordGuardIncident({ guildId, botId, kind, detail, now = Date.now() }) {
  try {
    const line = `• <t:${Math.floor(now / 1000)}:t> ${kind === "lockdown" ? "Verrouillage total démarré" : "Attaque bloquée par l'anti-nuke"} : ${String(detail ?? "").replace(/@/g, "＠").slice(0, 300)}`;
    const existing = openAutoIncident(guildId, now);
    if (existing) {
      const current = getSysPlusIncident(guildId, existing);
      const summary = `${current.summary}\n${line}`.slice(-1500);
      const severity = kind === "nuke" ? "critical" : current.severity;
      db.prepare("UPDATE sysplus_incidents SET summary = ?, severity = ?, updated_at = ? WHERE guild_id = ? AND incident_id = ?")
        .run(summary, severity, now, guildId, existing);
      return { incident: getSysPlusIncident(guildId, existing), created: false };
    }
    const incident = createSysPlusIncident(guildId, botId, {
      title: `${AUTO_PREFIX} ${kind === "lockdown" ? "Verrouillage du serveur" : "Tentative de nuke bloquée"}`,
      summary: `Ouvert automatiquement par GUARD.\n${line}`,
      severity: kind === "nuke" ? "critical" : "high",
    }, { authorizeActor: SYSTEM, now });
    return { incident, created: true };
  } catch {
    return { incident: null, created: false };
  }
}

/** Au déverrouillage : résout l'incident automatique ouvert, avec un résumé. */
export function resolveGuardLockdownIncident({ guildId, botId, actorId, reopenedChannels, now = Date.now() }) {
  try {
    const existing = db.prepare(`SELECT incident_id, created_at FROM sysplus_incidents
      WHERE guild_id = ? AND status != 'resolved' AND title LIKE ? ORDER BY updated_at DESC LIMIT 1`).get(guildId, `${AUTO_PREFIX}%`);
    if (!existing) return null;
    const minutes = Math.max(1, Math.round((now - Number(existing.created_at)) / 60_000));
    const resolution = `Serveur rouvert par le membre ${actorId} après ${minutes} min ; ${reopenedChannels} salon(s) rouverts. Vérifie le journal d'audit et la liste des rôles dangereux.`;
    return resolveSysPlusIncident(guildId, existing.incident_id, botId, resolution, { authorizeActor: SYSTEM, now });
  } catch {
    return null;
  }
}

/** Texte court pour le Logs Hub. */
export function autoIncidentNotice({ incident, created }) {
  if (!incident) return null;
  const id = incident.incidentId ?? incident.incident_id ?? incident.id;
  return created
    ? `📋 Incident SYS+ ouvert automatiquement : **${incident.title}** (\`${String(id).slice(0, 8)}\`). À prendre en charge : \`/sys-panel\` → incidents.`
    : `📋 Ajouté à l'incident SYS+ en cours (\`${String(id).slice(0, 8)}\`).`;
}
