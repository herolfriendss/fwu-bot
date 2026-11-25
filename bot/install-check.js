// /sysp diagnostic installation (idée S4 de l'Éclaireur) : bilan de santé en une commande.
// Lecture seule. Pour chaque bot présent : permissions attendues (MULTI_BOTS_FWU.md) et place
// de son rôle, puis base centrale, dernière sauvegarde et verrous de domaine.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "./database.js";
import { BOT_PROFILES, listDomainLeases } from "./bot-runtime.js";
import { loadRoleTiers } from "./shared/tiers.js";

const LABELS = {
  ManageMessages: "Gérer les messages", KickMembers: "Exclure", BanMembers: "Bannir", ModerateMembers: "Exclure temporairement",
  ManageRoles: "Gérer les rôles", ManageChannels: "Gérer les salons", ViewAuditLog: "Voir les logs", AddReactions: "Ajouter des réactions",
  Connect: "Se connecter", Speak: "Parler", MoveMembers: "Déplacer des membres", ManageNicknames: "Gérer les pseudos",
  ManageWebhooks: "Gérer les webhooks", MuteMembers: "Rendre muet", DeafenMembers: "Mettre en sourdine", SendMessages: "Envoyer des messages",
  EmbedLinks: "Intégrer des liens",
};

export const REQUIRED_PERMISSIONS = Object.freeze({
  fwu: ["SendMessages", "EmbedLinks", "ManageRoles", "ManageChannels", "ViewAuditLog"],
  guard: ["ManageMessages", "KickMembers", "BanMembers", "ModerateMembers", "ManageRoles", "ManageChannels", "ViewAuditLog", "AddReactions"],
  fdpdlavoc: ["Connect", "Speak", "MoveMembers", "ManageChannels", "ManageRoles"],
  suckme: ["ManageRoles", "ManageNicknames", "MoveMembers", "ViewAuditLog", "ManageMessages", "ManageWebhooks", "MuteMembers", "DeafenMembers", "ModerateMembers", "BanMembers"],
  fisc: ["ManageRoles"],
});

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

/** Pur : texte final. bots = [{ label, present, missing: [], placement: [] }]. */
export function formatInstallationReport({ bots, extraLines = [] }) {
  const lines = ["**Bilan de l'installation** (lecture seule)"];
  let warnings = 0;
  for (const bot of bots) {
    if (!bot.present) { lines.push(`⚪ **${bot.label}** : pas sur ce serveur (FWU fait son travail).`); continue; }
    const problems = [...bot.missing.map((p) => `permission manquante : ${p}`), ...bot.placement];
    if (!problems.length) lines.push(`✅ **${bot.label}** : permissions et place du rôle OK.`);
    else {
      warnings += problems.length;
      lines.push(`⚠️ **${bot.label}** :`, ...problems.map((p) => `　• ${p}`));
    }
  }
  lines.push(...extraLines);
  lines.push(warnings ? `\n👉 Corrige dans Paramètres du serveur → Rôles (permissions et ordre), puis relance la commande.` : "\n✅ Rien à corriger côté Discord.");
  return lines.join("\n").slice(0, 3900);
}

function botUserIds() {
  try {
    return Object.fromEntries(db.prepare("SELECT profile, user_id FROM fwu_bot_identities").all().map((row) => [row.profile, row.user_id]));
  } catch {
    return {};
  }
}

/** Collecte sur Discord puis formate. `extraLines` : base centrale, sauvegarde… */
export async function buildInstallationReport(guild, { ownerId = null, extraLines = [], now = Date.now() } = {}) {
  await guild.roles.fetch().catch(() => null);
  const ids = { ...botUserIds(), fwu: guild.client.user.id };
  const tiers = await loadRoleTiers(guild.id).catch(() => new Map());
  const tier0RoleIds = new Set([...tiers].filter(([, tier]) => tier === 0).map(([id]) => id));
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed }));
  const owner = ownerId ? await guild.members.fetch(ownerId).catch(() => null) : null;
  const bots = [];
  for (const profile of ["fwu", "guard", "fdpdlavoc", "suckme", "fisc"]) {
    const label = BOT_PROFILES[profile]?.label ?? profile;
    const member = ids[profile] ? await guild.members.fetch(ids[profile]).catch(() => null) : null;
    if (!member) { bots.push({ label, present: false, missing: [], placement: [] }); continue; }
    const perms = member.permissions;
    const admin = perms?.has?.(P.Administrator);
    const missing = admin ? [] : REQUIRED_PERMISSIONS[profile].filter((name) => !perms?.has?.(P[name])).map((name) => LABELS[name] ?? name);
    const placement = profile === "suckme"
      ? suckMePlacementIssues({ botTop: member.roles.highest.position, roles, tier0RoleIds, ownerTop: owner?.roles?.highest?.position ?? null })
      : [];
    bots.push({ label, present: true, missing, placement });
  }
  const leases = listDomainLeases(now);
  const stale = leases.filter((lease) => lease.domain !== "fwu" && !lease.live).map((lease) => BOT_PROFILES[lease.domain]?.label ?? lease.domain);
  const leaseLine = stale.length ? `🟧 Domaines repris par FWU (bot arrêté) : ${stale.join(", ")}.` : "🟢 Verrous de domaine : aucun bot arrêté.";
  return formatInstallationReport({ bots, extraLines: [leaseLine, ...extraLines] });
}
