// Client-safe helpers shared by the incident advisor route and UI.

export const INCIDENT_MIN = 10;
export const INCIDENT_MAX = 3000;

export type IncidentInput = { guildId: string; description: string };

/** Events streamed (NDJSON, one per line) from /api/incident to the browser. */
export type IncidentEvent =
  | { type: "status"; step: "journal" | "thinking" | "writing" }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export function parseIncidentInput(raw: unknown): IncidentInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const guildId = String(d["guildId"] ?? "");
  if (!/^\d{5,25}$/.test(guildId)) throw new Error("Serveur invalide");
  const description = String(d["description"] ?? "").trim();
  if (description.length < INCIDENT_MIN || description.length > INCIDENT_MAX) {
    throw new Error(`Décrivez l'incident en ${INCIDENT_MIN} à ${INCIDENT_MAX} caractères`);
  }
  return { guildId, description };
}

export const AUDIT_LABELS: Record<number, string> = {
  1: "Serveur modifié", 10: "Salon créé", 11: "Salon modifié", 12: "Salon supprimé", 20: "Membre expulsé",
  22: "Membre banni", 23: "Bannissement levé", 24: "Membre modifié (ex. sourdine)", 25: "Rôles d'un membre modifiés",
  30: "Rôle créé", 31: "Rôle modifié", 32: "Rôle supprimé", 72: "Message supprimé", 73: "Messages supprimés en masse",
};

/** Discord snowflake ids encode their creation time. */
export function snowflakeDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + 1420070400000);
}

export type AuditEntry = { id: string; action_type: number; user_id: string | null; target_id: string | null; reason?: string | null };

export function formatAuditEntry(e: AuditEntry, names: Map<string, string>): string {
  const date = snowflakeDate(e.id).toISOString().slice(0, 16).replace("T", " ");
  const by = e.user_id ? names.get(e.user_id) ?? e.user_id : "?";
  const target = e.target_id ? names.get(e.target_id) ?? e.target_id : "";
  const label = AUDIT_LABELS[e.action_type] ?? `Action n°${e.action_type}`;
  return `${date} UTC | ${label} | par ${by}${target ? ` | cible ${target}` : ""}${e.reason ? ` | raison : ${e.reason}` : ""}`;
}

/** Maps an AI Gateway HTTP status to a message the server owner can act on. */
export function aiErrorMessage(status: number | undefined): string {
  if (status === 402) return "Crédits IA épuisés : rechargez-les dans Paramètres → Plans & crédits.";
  if (status === 429) return "Trop de demandes en même temps. Patientez quelques secondes puis relancez l'analyse.";
  if (status === 403) return "L'accès au modèle d'IA est refusé pour cet espace de travail.";
  if (status === 401) return "La clé d'accès à l'IA est invalide ou manquante.";
  if (status && status >= 500) return "Le service d'IA est momentanément indisponible. Réessayez dans un instant.";
  return "L'analyse a échoué. Réessayez.";
}
