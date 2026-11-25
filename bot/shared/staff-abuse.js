// FWU — alerte d'abus du staff (idée SYS+ n°2 de l'Éclaireur).
//
// Après chaque sanction écrite dans la base centrale (tous bots), on regarde deux choses :
//  • rafale : un même membre du staff a posé N sanctions en W minutes ;
//  • cible répétée : il a sanctionné la même personne K fois en H heures.
// Si un seuil est franchi, l'alerte part en MP aux SYS+ (et à l'owner). Une même alerte
// n'est renvoyée qu'après 30 min, tous bots confondus (verrou + table en base).
// Les levées (unmute, unban) ne comptent pas. L'owner n'est jamais signalé.
// Rien n'est bloqué ni retiré ici : c'est une alerte, la décision reste humaine.
import { sharedQuery, sharedTransaction } from "./db.js";

export const DEFAULT_ABUSE_THRESHOLDS = Object.freeze({ burstCount: 5, burstMinutes: 10, repeatCount: 3, repeatHours: 24, enabled: true });
export const ABUSE_LIMITS = Object.freeze({
  burstCount: [2, 100], burstMinutes: [1, 1440], repeatCount: [2, 50], repeatHours: [1, 720],
});
export const ALERT_COOLDOWN_MINUTES = 30;
const LIFT_ACTIONS = ["unmute", "unban"];

function mapThresholds(row) {
  if (!row) return { ...DEFAULT_ABUSE_THRESHOLDS };
  return {
    burstCount: Number(row.burst_count), burstMinutes: Number(row.burst_minutes),
    repeatCount: Number(row.repeat_count), repeatHours: Number(row.repeat_hours),
    enabled: Boolean(row.enabled),
  };
}

export async function getAbuseThresholds(guildId, client = null) {
  const run = client ?? { query: sharedQuery };
  const { rows } = await run.query("SELECT * FROM staff_abuse_thresholds WHERE guild_id = $1", [guildId]);
  return mapThresholds(rows[0]);
}

/** Valide et fusionne les changements ; lève une erreur lisible si une valeur sort des bornes. */
export function mergeAbuseThresholds(current, changes = {}) {
  const next = { ...current };
  for (const [key, [min, max]] of Object.entries(ABUSE_LIMITS)) {
    if (changes[key] === undefined || changes[key] === null) continue;
    const value = Number(changes[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Valeur hors limites pour ${key} : entre ${min} et ${max}.`);
    next[key] = value;
  }
  if (typeof changes.enabled === "boolean") next.enabled = changes.enabled;
  return next;
}

/** Modifie les seuils (journalisé dans config_changes). */
export async function setAbuseThresholds({ guildId, changes, actorId, bot }) {
  return sharedTransaction(async (client) => {
    const before = await getAbuseThresholds(guildId, client);
    const next = mergeAbuseThresholds(before, changes);
    await client.query(`INSERT INTO staff_abuse_thresholds(guild_id, burst_count, burst_minutes, repeat_count, repeat_hours, enabled, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (guild_id) DO UPDATE SET burst_count = excluded.burst_count, burst_minutes = excluded.burst_minutes,
        repeat_count = excluded.repeat_count, repeat_hours = excluded.repeat_hours, enabled = excluded.enabled,
        updated_by = excluded.updated_by, updated_at = now()`,
    [guildId, next.burstCount, next.burstMinutes, next.repeatCount, next.repeatHours, next.enabled, actorId]);
    await client.query(`INSERT INTO config_changes(guild_id, actor_id, bot, entity, entity_key, before, after) VALUES ($1, $2, $3, 'staff_abuse', 'seuils', $4, $5)`,
      [guildId, actorId, bot, JSON.stringify(before), JSON.stringify(next)]);
    return next;
  });
}

async function recentlyAlerted(client, { guildId, moderatorId, kind, targetId }) {
  const { rows } = await client.query(`SELECT 1 FROM staff_abuse_alerts
    WHERE guild_id = $1 AND moderator_id = $2 AND kind = $3 AND target_id = $4 AND created_at > now() - make_interval(mins => $5) LIMIT 1`,
  [guildId, moderatorId, kind, targetId, ALERT_COOLDOWN_MINUTES]);
  return rows.length > 0;
}

/**
 * Vérifie les deux seuils pour la sanction qui vient d'être posée.
 * Renvoie la liste des alertes NOUVELLES (déjà enregistrées, donc à envoyer une seule fois).
 */
export async function checkStaffAbuse({ guildId, moderatorId, targetId, action, bot, ownerId = null }) {
  if (!guildId || !moderatorId || LIFT_ACTIONS.includes(action)) return [];
  if (ownerId && moderatorId === ownerId) return [];
  return sharedTransaction(async (client) => {
    const thresholds = await getAbuseThresholds(guildId, client);
    if (!thresholds.enabled) return [];
    // Un seul bot à la fois décide pour ce membre du staff : pas de double alerte.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`staff-abuse:${guildId}:${moderatorId}`]);
    const alerts = [];

    const burst = await client.query(`SELECT count(*)::int AS n, array_agg(DISTINCT target_id) AS targets FROM sanctions
      WHERE guild_id = $1 AND moderator_id = $2 AND action <> ALL($3) AND created_at > now() - make_interval(mins => $4)`,
    [guildId, moderatorId, LIFT_ACTIONS, thresholds.burstMinutes]);
    const burstCount = Number(burst.rows[0]?.n ?? 0);
    if (burstCount >= thresholds.burstCount && !(await recentlyAlerted(client, { guildId, moderatorId, kind: "burst", targetId: "" }))) {
      await client.query("INSERT INTO staff_abuse_alerts(guild_id, moderator_id, kind, target_id, count, bot) VALUES ($1, $2, 'burst', '', $3, $4)",
        [guildId, moderatorId, burstCount, bot]);
      alerts.push({ kind: "burst", moderatorId, count: burstCount, minutes: thresholds.burstMinutes, targets: (burst.rows[0]?.targets ?? []).filter(Boolean) });
    }

    if (targetId) {
      const repeat = await client.query(`SELECT count(*)::int AS n FROM sanctions
        WHERE guild_id = $1 AND moderator_id = $2 AND target_id = $3 AND action <> ALL($4) AND created_at > now() - make_interval(hours => $5)`,
      [guildId, moderatorId, targetId, LIFT_ACTIONS, thresholds.repeatHours]);
      const repeatCount = Number(repeat.rows[0]?.n ?? 0);
      if (repeatCount >= thresholds.repeatCount && !(await recentlyAlerted(client, { guildId, moderatorId, kind: "repeat", targetId }))) {
        await client.query("INSERT INTO staff_abuse_alerts(guild_id, moderator_id, kind, target_id, count, bot) VALUES ($1, $2, 'repeat', $3, $4, $5)",
          [guildId, moderatorId, targetId, repeatCount, bot]);
        alerts.push({ kind: "repeat", moderatorId, targetId, count: repeatCount, hours: thresholds.repeatHours });
      }
    }
    return alerts;
  });
}

/** Texte du MP envoyé aux SYS+. */
export function formatAbuseAlert(alert, guildName = "le serveur") {
  if (alert.kind === "burst") {
    const targets = alert.targets?.length ? `\nCibles : ${alert.targets.slice(0, 10).map((id) => `<@${id}>`).join(", ")}${alert.targets.length > 10 ? "…" : ""}` : "";
    return `🚨 **Alerte staff · ${guildName}**\n<@${alert.moderatorId}> a posé **${alert.count} sanctions en ${alert.minutes} min**.${targets}\nÀ vérifier : \`/sysp audit membre:\` ou \`/casier voir\`. En cas de compte piraté : \`/sysp urgence gel\`.`;
  }
  return `🚨 **Alerte staff · ${guildName}**\n<@${alert.moderatorId}> a sanctionné <@${alert.targetId}> **${alert.count} fois en ${alert.hours} h**.\nÀ vérifier : \`/casier voir\` sur la cible. Acharnement possible.`;
}

export function formatAbuseThresholds(t) {
  return [
    `État : ${t.enabled ? "✅ active" : "⏸️ coupée"}`,
    `Rafale : **${t.burstCount}** sanctions en **${t.burstMinutes}** min par le même membre du staff`,
    `Cible répétée : **${t.repeatCount}** sanctions sur la même personne en **${t.repeatHours}** h`,
    `Une même alerte n'est renvoyée qu'après ${ALERT_COOLDOWN_MINUTES} min. Les levées (unmute, unban) ne comptent pas.`,
  ].join("\n");
}
