import { db } from "./database.js";
import { getAntiMoveConfig } from "./anti-move.js";
import { LOGS_HUB_GUILD_ID } from "./logs-hub.js";
import {
  criticalPermissionsForProfile,
  requiredPermissionsForProfile,
} from "./permissions-catalog.js";

/**
 * Bot health: a pure evaluator plus a collector. The collector only reads
 * process/Discord cache state and SQLite counters; it never prints secrets,
 * message content or member data.
 */
let provider = () => ({ events: [], lastSync: null, startedAt: null });

export function registerHealthProvider(fn) {
  if (typeof fn === "function") provider = fn;
}



/** Pure evaluation of a collected snapshot. */
export function evaluateHealth(snapshot, now = Date.now()) {
  const checks = [];
  const add = (name, severity, detail) =>
    checks.push({ name, severity, detail });

  const ping = Number(snapshot.wsPing);
  if (!snapshot.ready)
    add("Gateway", "critical", "Connexion Discord non prête.");
  else if (Number.isFinite(ping) && ping > 1_000)
    add("Gateway", "warning", `Latence élevée : ${ping} ms.`);
  else
    add(
      "Gateway",
      "ok",
      Number.isFinite(ping) && ping >= 0
        ? `Connecté, ${ping} ms.`
        : "Connecté.",
    );

  const syncAge = snapshot.lastSync
    ? now - Date.parse(snapshot.lastSync)
    : null;
  if (syncAge == null || !Number.isFinite(syncAge))
    add(
      "Synchronisation site",
      "warning",
      "Aucune synchronisation réussie depuis le démarrage.",
    );
  else if (syncAge > 5 * 60_000)
    add(
      "Synchronisation site",
      "warning",
      `Dernière synchronisation il y a ${Math.round(syncAge / 60_000)} min.`,
    );
  else
    add(
      "Synchronisation site",
      "ok",
      `Il y a ${Math.round(syncAge / 1000)} s.`,
    );

  const missing = snapshot.missingPermissions ?? [];
  const criticalPermissions = criticalPermissionsForProfile(snapshot.profile);
  if (missing.length)
    add(
      "Permissions du bot",
      missing.some((p) => criticalPermissions.includes(p.name))
        ? "critical"
        : "warning",
      `Manquantes : ${missing.map((p) => p.label).join(" ; ")}.`,
    );
  else
    add(
      "Permissions du bot",
      "ok",
      "Toutes les permissions attendues sont présentes.",
    );

  if (
    snapshot.profile === "suckme" &&
    snapshot.antiMoveEnabled &&
    missing.some((p) => ["MoveMembers", "ViewAuditLog"].includes(p.name))
  ) {
    add(
      "Anti-Move",
      "critical",
      "Activé mais inopérant : permissions Déplacer des membres / Voir les logs manquantes.",
    );
  }

  if (snapshot.logsHubPresent === false)
    add(
      "Logs Hub",
      "warning",
      "Le bot n'est pas présent sur le serveur central de logs.",
    );
  else if (snapshot.logsHubPresent)
    add("Logs Hub", "ok", "Serveur central joignable.");

  if (snapshot.database !== "ok")
    add(
      "Base SQLite",
      "critical",
      `Vérification d'intégrité : ${snapshot.database}.`,
    );
  else add("Base SQLite", "ok", "quick_check OK.");

  const errors = snapshot.recentErrorCodes ?? [];
  if (errors.length >= 10)
    add(
      "Erreurs récentes",
      "warning",
      `${errors.length} erreurs dans les 50 derniers événements (${[...new Set(errors)].slice(0, 5).join(", ")}).`,
    );
  else
    add(
      "Erreurs récentes",
      "ok",
      errors.length
        ? `${errors.length} erreur(s) : ${[...new Set(errors)].slice(0, 5).join(", ")}.`
        : "Aucune.",
    );

  if ((snapshot.rankallRunning ?? 0) > 0)
    add(
      "Rankall",
      "info",
      `${snapshot.rankallRunning} attribution(s) générale(s) en cours.`,
    );

  const status = checks.some((c) => c.severity === "critical")
    ? "critical"
    : checks.some((c) => c.severity === "warning")
      ? "degraded"
      : "ok";
  return { status, checks };
}

function count(sql, ...params) {
  try {
    return Number(db.prepare(sql).get(...params)?.c ?? 0);
  } catch {
    return 0;
  }
}

export function collectHealthSnapshot(client, guild, profile = "fwu") {
  const { events = [], lastSync = null, startedAt = null } = provider() ?? {};
  let database = "ok";
  try {
    const result = db.prepare("PRAGMA quick_check").get();
    const value = result ? Object.values(result)[0] : "inconnu";
    database = value === "ok" ? "ok" : String(value).slice(0, 80);
  } catch {
    database = "erreur de lecture";
  }
  const me = guild?.members?.me;
  const required = requiredPermissionsForProfile(profile);
  const missingPermissions = required
    .filter((name) => !me?.permissions?.has?.(name))
    .map((name) => ({ name, label: name }));
  return {
    profile,
    ready: Boolean(client?.isReady?.() ?? client?.readyAt),
    wsPing: client?.ws?.ping,
    uptimeMs: client?.uptime ?? null,
    startedAt,
    lastSync,
    missingPermissions,
    antiMoveEnabled: profile === "suckme" && guild ? getAntiMoveConfig(guild.id).enabled : false,
    // Only FWU owns the central Logs Hub. Dedicated bots send their logs through its relay.
    logsHubPresent: profile === "fwu"
      ? (client?.guilds?.cache ? client.guilds.cache.has(LOGS_HUB_GUILD_ID) : null)
      : null,
    database,
    recentErrorCodes: events
      .map((e) => e.code)
      .filter((code) => /error|failed|refused|rejection/.test(code)),
    rankallRunning: profile === "suckme"
      ? count("SELECT COUNT(*) c FROM rankall_jobs WHERE status='running' AND guild_id=?", guild?.id ?? "")
      : 0,
    pvLocks: ["fdpdlavoc", "suckme"].includes(profile)
      ? count("SELECT COUNT(*) c FROM voice_lock_snapshots WHERE guild_id=?", guild?.id ?? "")
      : 0,
    menottes: profile === "suckme"
      ? count("SELECT COUNT(*) c FROM voice_menottes WHERE guild_id=?", guild?.id ?? "")
      : 0,
    antiMoveProtected: profile === "suckme"
      ? count("SELECT COUNT(*) c FROM anti_move_protected_members WHERE guild_id=?", guild?.id ?? "")
      : 0,
  };
}

export function formatHealthReport(snapshot, evaluation) {
  const icon = { ok: "🟢", info: "🔵", warning: "🟠", critical: "🔴" };
  const header = {
    ok: "🟢 **Santé : bonne**",
    degraded: "🟠 **Santé : dégradée**",
    critical: "🔴 **Santé : critique**",
  }[evaluation.status];
  const uptime = snapshot.uptimeMs
    ? `${Math.floor(snapshot.uptimeMs / 3_600_000)} h ${Math.floor((snapshot.uptimeMs % 3_600_000) / 60_000)} min`
    : "inconnue";
  return [
    header,
    `Disponibilité : ${uptime}`,
    ...evaluation.checks.map(
      (c) => `${icon[c.severity]} **${c.name}** — ${c.detail}`,
    ),
    `État persistant : ${snapshot.pvLocks ?? 0} salon(s) privatisé(s) · ${snapshot.menottes ?? 0} menotte(s) · ${snapshot.antiMoveProtected ?? 0} membre(s) protégé(s) Anti-Move.`,
  ].join("\n");
}

export function buildHealthReport(client, guild, now = Date.now(), profile = "fwu") {
  const snapshot = collectHealthSnapshot(client, guild, profile);
  const evaluation = evaluateHealth(snapshot, now);
  return {
    snapshot,
    evaluation,
    text: formatHealthReport(snapshot, evaluation),
  };
}
