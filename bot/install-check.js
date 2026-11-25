// /sysp diagnostic installation (idée S4 de l'Éclaireur) : bilan de santé en une commande.
// Lecture seule. Pour chaque bot présent : permissions attendues (MULTI_BOTS_FWU.md) et place
// de son rôle, puis base centrale, dernière sauvegarde et verrous de domaine.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "./database.js";
import { BOT_PROFILES, BOT_PROFILE_IDS, listDomainLeases } from "./bot-runtime.js";
import { PERMISSION_LABELS, REQUIRED_PERMISSIONS } from "./permissions-catalog.js";
import { loadRoleTiers } from "./shared/tiers.js";

export { REQUIRED_PERMISSIONS };

/** Pur : rôles que SUCK ME doit dominer (0 % et laisses DOG) mais qui sont au-dessus ou au même niveau. */
export function suckMePlacementIssues({ botTop, roles, tier0RoleIds, ownerTop }) {
  const issues = [];
  for (const role of roles) {
    const watched = tier0RoleIds.has(role.id) || /^En laisse/u.test(role.name);
    if (watched && role.position >= botTop) issues.push(`son rôle doit passer au-dessus de **${role.name}**`);
  }
  if (ownerTop != null) {
    const between = roles.filter((r) => !r.managed && r.position > botTop && r.position < ownerTop).length;
    if (between > 0) issues.push(`son rôle doit être **juste sous ton rôle** (${between} rôle(s) entre les deux)`);
  }
  return issues;
}

/** Each bot role must sit below the PND OWNER and above every human-managed role it may administer. */
export function botPlacementIssues({ botTop, roles, ownerTop, ownerRoleIds = new Set() }) {
  const issues = [];
  if (!Number.isFinite(botTop)) return ["position du rôle du bot impossible à vérifier"];
  if (!Number.isFinite(ownerTop)) {
    issues.push("rôle OWNER introuvable : impossible de garantir que le bot reste sous l'OWNER");
  } else if (botTop >= ownerTop) {
    issues.push("le rôle du bot doit rester strictement sous le rôle OWNER");
  }
  const above = roles.filter((role) =>
    !role.managed && !ownerRoleIds.has(role.id) && role.position >= botTop
  );
  if (above.length) {
    const names = above.slice(0, 4).map((role) => role.name).join(", ");
    issues.push(`le rôle du bot doit passer au-dessus des rôles qu'il doit gérer : ${names}${above.length > 4 ? ", …" : ""}`);
  }
  return issues;
}

/** Pur : texte final. bots = [{ label, present, missing: [], placement: [] }]. */
export function formatInstallationReport({ bots, extraLines = [] }) {
  const lines = ["**Bilan de l'installation** (lecture seule)"];
  let missingBots = 0;
  let permissionProblems = 0;
  for (const bot of bots) {
    if (!bot.present) {
      if (bot.optional) {
        lines.push(`⚪ **${bot.label}** : facultatif, non installé sur ce serveur.`);
      } else {
        missingBots += 1;
        lines.push(`🟠 **${bot.label}** : absent. FWU peut reprendre les événements de son domaine, mais les commandes propres à cette application sont indisponibles sur ce serveur.`);
      }
      continue;
    }
    const problems = [...bot.missing.map((p) => `permission manquante : ${p}`), ...bot.placement];
    if (!problems.length) lines.push(`✅ **${bot.label}** : permissions et place du rôle OK.`);
    else {
      permissionProblems += problems.length;
      lines.push(`⚠️ **${bot.label}** :`, ...problems.map((p) => `　• ${p}`));
    }
  }
  lines.push(...extraLines);
  if (missingBots) {\n    const noun = missingBots === 1 ? "application principale absente" : "applications principales absentes";\n    lines.push(`\n👉 Réinvite ou redémarre ${missingBots} ${noun}, puis vérifie que chacune a rejoint tous les serveurs autorisés.`);\n  }
  if (permissionProblems) lines.push("\n👉 Corrige les permissions Discord et l'ordre des rôles dans Paramètres du serveur → Rôles, puis relance la commande.");
  if (!missingBots && !permissionProblems) lines.push("\n✅ Rien à corriger côté Discord.");
  return lines.join("\n").slice(0, 3900);
}

function botUserIds() {
  try {
    return Object.fromEntries(db.prepare("SELECT profile, user_id FROM fwu_bot_identities").all().map((row) => [row.profile, row.user_id]));
  } catch {
    return {};
  }
}

/** Ensure the application running the diagnostic is identified under its own profile, not always FWU. */
export function resolveInstallationBotIds(savedIds, currentProfile, currentBotId) {
  const ids = { ...(savedIds ?? {}) };
  if (BOT_PROFILE_IDS.includes(currentProfile) && currentBotId) ids[currentProfile] = currentBotId;
  return ids;
}

/** Collecte sur Discord puis formate. `extraLines` : base centrale, sauvegarde… */
export async function buildInstallationReport(guild, {
  ownerId = null,
  extraLines = [],
  now = Date.now(),
  currentProfile = "fwu",
  currentBotId = guild?.client?.user?.id ?? null,
} = {}) {
  await guild.roles.fetch().catch(() => null);
  const ids = resolveInstallationBotIds(botUserIds(), currentProfile, currentBotId);
  const tiers = await loadRoleTiers(guild.id).catch(() => new Map());
  const tier0RoleIds = new Set([...tiers].filter(([, tier]) => tier === 0).map(([id]) => id));
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed }));
  const owner = ownerId ? await guild.members.fetch(ownerId).catch(() => null) : null;
  const bots = [];
  for (const profile of BOT_PROFILE_IDS) {
    const label = BOT_PROFILES[profile]?.label ?? profile;
    const optional = Boolean(BOT_PROFILES[profile]?.optional);
    const member = ids[profile] ? await guild.members.fetch(ids[profile]).catch(() => null) : null;
    if (!member) { bots.push({ profile, label, optional, present: false, missing: [], placement: [] }); continue; }
    const perms = member.permissions;
    const admin = perms?.has?.(P.Administrator);
    const missing = admin ? [] : REQUIRED_PERMISSIONS[profile].filter((name) => !perms?.has?.(P[name])).map((name) => PERMISSION_LABELS[name] ?? name);
    const ownerRoleIds = new Set(owner?.roles?.cache?.keys?.() ?? []);
    const botTop = member.roles?.highest?.position;
    const placement = botPlacementIssues({
      botTop,
      roles,
      ownerTop: owner?.roles?.highest?.position ?? null,
      ownerRoleIds,
    });
    if (profile === "suckme") {
      placement.push(...suckMePlacementIssues({
        botTop,
        roles,
        tier0RoleIds,
        ownerTop: owner?.roles?.highest?.position ?? null,
      }).filter((issue) => !placement.some((existing) => existing === issue)));
    }
    bots.push({ profile, label, optional, present: true, missing, placement });
  }
  const leases = listDomainLeases(now);
  const stale = leases
    .filter((lease) => lease.domain !== "fwu" && !lease.live && !BOT_PROFILES[lease.domain]?.optional)
    .map((lease) => BOT_PROFILES[lease.domain]?.label ?? lease.domain);
  const leaseLine = stale.length
    ? `🟧 Domaines principaux repris par FWU (bot arrêté) : ${stale.join(", ")}.`
    : "🟢 Verrous des bots principaux : aucun arrêt détecté.";
  const optionalProfiles = BOT_PROFILE_IDS.filter((id) => BOT_PROFILES[id]?.optional);
  const optionalLine = optionalProfiles
    .filter((id) => !leases.some((lease) => lease.domain === id && lease.live))
    .map((id) => `${BOT_PROFILES[id].label} facultatif : aucun verrou actif.`);

  return formatInstallationReport({ bots, extraLines: [leaseLine, ...optionalLine, ...extraLines] });
}
