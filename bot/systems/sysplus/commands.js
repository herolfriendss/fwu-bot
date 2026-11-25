import { handlePackPrefix } from "../entitlements/commands.js";
import { handleStudioInteraction, handleStudioPrefix } from "../creator/commands.js";
import { handleMarketPrefix } from "../marketplace/commands.js";
import { activeEntitlementKeys } from "../../entitlements.js";
import { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { canConfigureAdminPlus, canConfigureSysPlus, isAdminPlus, isSysPlus } from "./permissions.js";
import { getAdminPlusRoleId, setAdminPlusRoleId } from "./role-config.js";
import { listSysPlusAudit, recordSysPlusAudit } from "./audit.js";
import { isValidWhitelistRole } from "./whitelist-policy.js";
import { herBotAvatar, themePanelEmbed } from "../../theme.js";
import { sysMemberActionDecision } from "./member-policy.js";
import { ADMIN_PLUS_SCOPES, getAdminPlusScope, setAdminPlusScope } from "./admin-plus-scopes.js";
import { getStaffSupervisor, listStaffSupervisors, removeStaffSupervisor, setStaffSupervisor } from "../../staff-hierarchy.js";
import { createGuildBlueprint, getGuildBlueprintSnapshot, listGuildBlueprints, compareGuildBlueprint } from "../../guild-blueprints.js";
import {
  applyServerClonePlan, authorizeServerClone, buildServerClonePlan, CLONE_DENIAL_MESSAGES,
  createDiscordCloneExecutor,
} from "../../server-clone.js";
import { createSysPlusIncident, listSysPlusIncidents, getSysPlusIncident, assignSysPlusIncident, resolveSysPlusIncident, updateSysPlusIncidentStatus, buildSysPlusIncidentReport } from "./incidents.js";
import { createCommandbook, getCommandbook, listCommandbooks, deleteCommandbook, searchSysPlusWorkspace } from "./workspace.js";
import { describeIntelligenceSyncFailure, readSyncResponse } from "../../sysplus-sync.js";
import { analyzeGuildAcl, formatAclReport, normalizeGuildForAcl } from "../../acl-risk.js";
import { buildHealthReport } from "../../health-report.js";
import { formatCoverageSummary } from "../../logs-coverage.js";
import { buildPermissionMatrix, formatPermissionMatrix } from "../../permission-matrix.js";
import { reconcileEconomyGuild } from "../../economy-integrity.js";
import { listReconciliationReviews } from "../../economy.js";
import { describeSignal, listFraudSignals } from "../../economy-antifraud.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";
import { formatBotsDiagnostic, formatRelayLossLine } from "../../bot-runtime.js";
import { formatSharedDbLine } from "../../shared/index.js";
import { formatBackupLine, readBackupStatus } from "../../backup-status.js";
import { buildInstallationReport } from "../../install-check.js";
import { handleFreezeCommand } from "./freeze-commands.js";
import { handleAbuseAlertCommand } from "./abuse-alerts.js";
import { handleMemberCardCommand } from "./member-card.js";
import { handleStaffStatsCommand } from "./staff-stats.js";
import { parsePndOwnerId } from "../../pnd-owner-policy.js";

const DIAGNOSTIC_ACTIONS = new Set(["acl", "sante", "santé", "logs-couverture", "matrice", "economie", "économie", "bots", "installation"]);

/** Read-only diagnostics shared by =sysp and /sysp diagnostic. Throws user-facing errors. */
export async function runSysPlusDiagnostic(guild, member, roleId, action, record = () => {}, whitelistRoleId = null) {
  if (!isSysPlus(member, roleId)) throw new Error("⛔ Diagnostics réservés au rôle Perm SYS+.");
  if (action === "acl") {
    await guild.roles.fetch().catch(() => null);
    await guild.members.fetch().catch(() => null);
    const findings = analyzeGuildAcl(normalizeGuildForAcl(guild, { sysPlusRoleId: roleId, adminPlusRoleId: getAdminPlusRoleId(guild.id) }));
    recordSysPlusAudit(guild.id, member.id, "diagnostic.acl", null, { findings: findings.length, critical: findings.filter((f) => f.severity === "critical").length });
    if (findings.some((f) => f.severity === "critical")) record("acl_critical_found");
    return formatAclReport(findings);
  }
  if (action === "sante" || action === "santé") {
    const { text } = buildHealthReport(guild.client, guild);
    recordSysPlusAudit(guild.id, member.id, "diagnostic.health", null, {});
    return text;
  }
  if (action === "logs-couverture") return formatCoverageSummary();
  if (action === "installation") {
    recordSysPlusAudit(guild.id, member.id, "diagnostic.installation", null, {});
    return buildInstallationReport(guild, { ownerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID), extraLines: [formatSharedDbLine(), formatBackupLine(readBackupStatus())] });
  }
  if (action === "bots") return `${formatBotsDiagnostic()}\n${formatRelayLossLine()}\n${formatSharedDbLine()}\n${formatBackupLine(readBackupStatus())}`;
  if (action === "matrice") {
    const scopes = Object.fromEntries(Object.keys(ADMIN_PLUS_SCOPES).map((scope) => [scope, getAdminPlusScope(guild.id, scope)]));
    return formatPermissionMatrix(buildPermissionMatrix({
      guildId: guild.id, guildOwnerId: guild.ownerId, sysPlusRoleId: roleId,
      adminPlusRoleId: getAdminPlusRoleId(guild.id), whitelistRoleId: whitelistRoleId ?? null, scopes,
    }));
  }
  if (action === "economie" || action === "économie") {
    const issues = reconcileEconomyGuild(guild.id);
    const signals = listFraudSignals(guild.id);
    recordSysPlusAudit(guild.id, member.id, "diagnostic.economy", null, { issues: issues.length, signals: signals.length });
    return [
      "**Économie PND — intégrité et fraude** (lecture seule)",
      issues.length ? `🟥 ${issues.length} écart(s) solde ↔ grand livre :\n${issues.slice(0, 8).map((i) => `• ${i.accountType} \`${i.accountId}\` : stocké ${i.stored ?? "absent"} / grand livre ${i.ledger}`).join("\n")}` : "🟢 Soldes conformes au grand livre.",
      (() => { const reviews = listReconciliationReviews(guild.id); return reviews.length ? `🟧 ${reviews.length} opération(s) marché/enchère à examiner :\n${reviews.slice(0, 8).map((r) => `• ${r.kind} #${r.ref_id} : ${r.reason}`).join("\n")}` : "🟢 Aucune opération marché/enchère en attente de revue."; })(),
      signals.length ? `🚩 ${signals.length} signal(aux) à examiner :\n${signals.slice(0, 8).map((sig) => `• #${sig.id} ${describeSignal(sig)}`).join("\n")}` : "🟢 Aucun signal de fraude ouvert.",
      "Aucune correction ni sanction automatique.",
    ].join("\n");
  }
  throw new Error("Diagnostic inconnu : `acl`, `sante`, `logs-couverture`, `matrice`, `economie` ou `bots`.");
}

const AUTH = (secret) => ({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });


/**
 * Shared Server Clone business flow for =sysp clone and /sysp clone. Returns the
 * user-facing text. Denials are returned as ⛔ text; malformed input throws.
 */
export async function runServerCloneAction({ guild, member, actorId, roleId, action, blueprintRef, token, record = () => {} }) {
  const normalized = String(action ?? "").toLowerCase();
  if (normalized !== "plan" && normalized !== "apply") throw new Error("Utilise `plan <blueprint>` puis `apply <blueprint> <jeton>`.");
  if (!blueprintRef || String(blueprintRef).length < 4) throw new Error("Indique l'identifiant du blueprint (au moins 4 caractères).");
  const rows = listGuildBlueprints(guild.id);
  const matches = rows.filter((row) => row.blueprintId === blueprintRef || row.blueprintId.startsWith(blueprintRef));
  if (matches.length !== 1) throw new Error("Identifiant de blueprint introuvable ou ambigu.");

  const decision = authorizeServerClone({
    guildId: guild.id,
    actorId,
    tiers: isSysPlus(member, roleId) ? ["SYS_PLUS"] : [],
    entitlements: activeEntitlementKeys(guild.id, Date.now()),
    confirmed: normalized === "apply",
  });
  if (!decision.allowed) return `⛔ ${CLONE_DENIAL_MESSAGES[decision.code] ?? "Action Server Clone refusée."}`;

  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const blueprint = getGuildBlueprintSnapshot(guild.id, matches[0].blueprintId);
  const plan = buildServerClonePlan({ snapshot: blueprint.snapshot, guild });
  const summary = `${plan.roles.length} rôle(s) et ${plan.channels.length} salon(s) à créer · ${plan.existingRoleMap.length} rôle(s) et ${plan.skippedExistingChannels.length} salon(s) déjà présents (inchangés)`;

  if (normalized === "plan") {
    const warnings = plan.warnings.length ? `\n⚠️ ${plan.warnings.slice(0, 3).join("\n⚠️ ")}` : "";
    const stripped = plan.stripped.length ? `\n🔒 Permissions sensibles retirées : ${plan.stripped.map((item) => `${item.role} (${item.bits.join(", ")})`).join(" · ")}` : "";
    return `**Server Clone — plan pour ${blueprint.name}**\n${summary}${warnings}${stripped}\nJeton : \`${plan.token}\`\nAucune modification n'a été faite. Pour appliquer : \`=sysp clone apply ${matches[0].blueprintId.slice(0, 8)} ${plan.token}\``;
  }

  if (String(token ?? "") !== plan.token) {
    return "⛔ Le plan a changé depuis l'aperçu (ou le jeton est incorrect). Relance `plan` pour obtenir un jeton à jour. Aucune modification n'a été faite.";
  }
  const result = await applyServerClonePlan({ plan, token: plan.token, rebuilt: plan, executor: createDiscordCloneExecutor(guild) });
  recordSysPlusAudit(guild.id, actorId, "sysplus.clone.apply", matches[0].blueprintId, { code: result.code, createdRoles: result.createdRoles, createdChannels: result.createdChannels, failures: result.failures.length });
  record("sysplus_clone_applied");
  return `${result.ok ? "✅" : "⚠️"} Server Clone ${result.code === "APPLIED" ? "appliqué" : `terminé avec l'état ${result.code}`} : ${result.createdRoles} rôle(s) et ${result.createdChannels} salon(s) créés${result.failures.length ? ` · ${result.failures.length} échec(s)` : ""}.`;
}

export async function handleSysPlusMessage(message, settings, { apiUrl, secret, record, audit = () => {} }) {
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  if (command !== "=sysp") return false;

  const roleId = settings?.sysPlus?.roleId ?? null;
  const args = parts.slice(1);

  if (DIAGNOSTIC_ACTIONS.has(args[0]?.toLowerCase())) {
    try {
      const text = await runSysPlusDiagnostic(message.guild, message.member, roleId, args[0].toLowerCase(), record, settings?.sysPlus?.whitelistRoleId ?? null);
      await message.reply({ content: text.slice(0, 1990), allowedMentions: { parse: [] } });
    } catch (error) {
      await message.reply({ content: error instanceof Error ? error.message : "Diagnostic impossible.", allowedMentions: { parse: [] } });
    }
    return true;
  }

  // Only the configured PND Owner can delegate or reconfigure ADMIN+.
  if (args[0]?.toLowerCase() === "admin-role") {
    if (!canConfigureAdminPlus(message.member)) {
      await message.reply("⛔ Seul le Owner PND peut configurer le rôle ADMIN+.");
      return true;
    }
    const roleMention = message.mentions.roles.first();
    const rawId = args[1]?.replace(/[<@&>]/g, "");
    const targetId = roleMention?.id ?? (rawId && /^\d{5,25}$/.test(rawId) ? rawId : null);
    if (!targetId) {
      await message.reply("Utilisation : `=sysp admin-role @Rôle`");
      return true;
    }
    const role = await message.guild.roles.fetch(targetId, { force: true }).catch(() => null);
    if (!role || role.managed || role.id === message.guild.id) {
      await message.reply("❌ Rôle invalide. Mentionne un rôle normal du serveur.");
      return true;
    }
    setAdminPlusRoleId(message.guild.id, role.id, message.author.id);
    recordSysPlusAudit(message.guild.id, message.author.id, "adminplus.role.update", role.id, { name: role.name });
    record("adminplus_role_updated");
    await message.reply(`✅ **${role.name}** est maintenant le rôle ADMIN+ de ce serveur. Ce niveau ne donne pas accès aux commandes SYS+ réservées.`);
    return true;
  }

  // SYS+ configuration is deliberately restricted to the unique configured PND Owner.
  if (args[0]?.toLowerCase() === "role") {
    if (!canConfigureSysPlus(message.member)) {
      await message.reply("⛔ Seul le Owner PND peut configurer le rôle Perm SYS+.");
      return true;
    }
    const roleMention = message.mentions.roles.first();
    const rawId = args[1]?.replace(/[<@&>]/g, "");
    const targetId = roleMention?.id ?? (rawId && /^\d{5,25}$/.test(rawId) ? rawId : null);
    if (!targetId) {
      await message.reply("Utilisation : `=sysp role @Rôle`");
      return true;
    }
    const role = await message.guild.roles.fetch(targetId, { force: true }).catch(() => null);
    if (!role || role.managed || role.id === message.guild.id) {
      await message.reply("❌ Rôle invalide. Mentionne un rôle normal du serveur.");
      return true;
    }
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: AUTH(secret),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ action: "set-sysplus-role", guildId: message.guild.id, roleId: role.id, actorId: message.author.id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      settings.sysPlus = { ...(settings.sysPlus ?? {}), roleId: role.id };
      recordSysPlusAudit(message.guild.id, message.author.id, "sysplus.role.update", role.id, { name: role.name });
      record("sysplus_role_updated");
      await message.reply(`✅ Le rôle **${role.name}** est maintenant le rôle Perm Sys+ de ce serveur. La configuration est enregistrée sur le site.${result.auditRecorded === false ? " ⚠️ L’audit n’a pas pu être enregistré." : ""}`);
    } catch {
      await message.reply("❌ Impossible d'enregistrer le rôle dans Supabase via le site. Vérifie la synchronisation et réessaie.");
    }
    return true;
  }

  if (!isSysPlus(message.member, roleId)) {
    await message.reply("⛔ Accès réservé au rôle Perm Sys+.");
    return true;
  }

  if (args[0]?.toLowerCase() === "composer") {
    const action = (args[1] ?? "list").toLowerCase();
    const authorizeActor = ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && isSysPlus(message.member, roleId);
    try {
      if (action === "create") {
        const payload = message.content.replace(/^=sysp\s+composer\s+create\s+/i, "");
        const [name, description, body] = payload.split("|").map((part) => part.trim());
        const item = createCommandbook(message.guild.id, message.author.id, { name, description, body }, { authorizeActor });
        recordSysPlusAudit(message.guild.id, message.author.id, "commandbook.create", item.id, { name: item.name });
        await message.reply({ content: `🧩 Runbook **${item.name}** enregistré. Il s'agit d'une procédure documentée : aucune commande ni action Discord n'est exécutée automatiquement.`, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "list") {
        const rows = listCommandbooks(message.guild.id, 20);
        await message.reply({ content: rows.length ? `**Command Composer — procédures enregistrées**\n${rows.map((item) => `• \`${item.name}\` — ${item.description}`).join("\n")}` : "Aucun runbook. Crée-en un avec `=sysp composer create nom | description | procédure`.", allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "show") {
        const item = getCommandbook(message.guild.id, args[2]);
        if (!item) throw new Error("Runbook introuvable.");
        await message.reply({ content: `**${item.name}**\n${item.description}\n\n${item.body.slice(0, 1800)}`, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "delete") {
        const item = deleteCommandbook(message.guild.id, message.author.id, args[2], { authorizeActor });
        recordSysPlusAudit(message.guild.id, message.author.id, "commandbook.delete", item.id, { name: item.name });
        await message.reply({ content: `🗑️ Runbook **${item.name}** supprimé.`, allowedMentions: { parse: [] } });
        return true;
      }
      throw new Error("Utilise `=sysp composer create nom | description | procédure`, `list`, `show <nom>` ou `delete <nom>`.");
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Erreur Command Composer."}`, allowedMentions: { parse: [] } });
      return true;
    }
  }

  if (args[0]?.toLowerCase() === "search") {
    try {
      const query = args.slice(1).join(" ");
      const results = searchSysPlusWorkspace(message.guild.id, query, { limit: 8 });
      const lines = results.map((item) => `• **[${item.type}] ${item.title}** — ${item.summary.slice(0, 180)}`);
      await message.reply({ content: results.length ? `🔎 **Smart Search — résultats pour « ${query.slice(0, 80)} »**\n${lines.join("\n")}` : `Aucun résultat pour « ${query.slice(0, 80)} ».`, allowedMentions: { parse: [] } });
      return true;
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Recherche impossible."}`, allowedMentions: { parse: [] } });
      return true;
    }
  }

  if (args[0]?.toLowerCase() === "incident") {
    const action = (args[1] ?? "list").toLowerCase();
    const authorizeActor = ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && isSysPlus(message.member, roleId);
    try {
      if (action === "create") {
        const [severity, title, ...details] = message.content.replace(/^=sysp\s+incident\s+create\s+/i, "").split("|").map((part) => part.trim());
        const incident = createSysPlusIncident(message.guild.id, message.author.id, { severity, title, summary: details.join(" | ") }, { authorizeActor });
        recordSysPlusAudit(message.guild.id, message.author.id, "incident.create", incident.incidentId, { severity, title: incident.title });
        audit(message.guild, "SYS+ — incident créé", `Créé par : <@${message.author.id}>\nGravité : **${severity}**\nTitre : **${incident.title}**\nRéférence : \`${incident.incidentId.slice(0, 8)}\``);
        await message.reply(`🚨 Incident **${incident.title}** créé · **${incident.severity}** · référence \`${incident.incidentId.slice(0, 8)}\`.`);
        return true;
      }
      if (action === "list") {
        const incidents = listSysPlusIncidents(message.guild.id, { status: "all", limit: 10 });
        await message.reply(incidents.length ? `**Centre d'incidents SYS+**\n${incidents.map((item) => `• \`${item.incidentId.slice(0, 8)}\` · **${item.severity}** · ${item.status} · ${item.title}`).join("\n")}` : "Aucun incident enregistré.");
        return true;
      }
      if (action === "show") {
        const token = args[2] ?? "";
        const matches = listSysPlusIncidents(message.guild.id, { status: "all", limit: 50 }).filter((item) => item.incidentId === token || item.incidentId.startsWith(token));
        if (matches.length !== 1) throw new Error("Incident introuvable ou identifiant ambigu.");
        const item = matches[0];
        await message.reply(`**${item.title}** · ${item.severity} · ${item.status}\n${item.summary}\nCréé par <@${item.createdBy}>${item.assignedTo ? ` · Assigné à <@${item.assignedTo}>` : " · Non assigné"}${item.resolution ? `\nRésolution : ${item.resolution}` : ""}`);
        return true;
      }
      if (action === "assign") {
        const match = (args[2] ?? "").match(/^([a-f0-9-]{8,36})$/i);
        const userId = args[3]?.match(/^<@!?(\d{5,25})>$/)?.[1];
        if (!match || !userId) throw new Error("Utilise `=sysp incident assign <id> <@responsable>`.");
        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target || target.user?.bot) throw new Error("Le responsable doit être un membre humain du serveur.");
        const targetIsStaff = isSysPlus(target, roleId) || isAdminPlus(target, roleId, getAdminPlusRoleId(message.guild.id)) || target.permissions?.has?.(PermissionFlagsBits.ManageGuild) || target.permissions?.has?.(PermissionFlagsBits.Administrator);
        if (!targetIsStaff) throw new Error("Le responsable doit appartenir au staff SYS+/ADMIN+ ou disposer des permissions Discord de gestion.");
        const incident = listSysPlusIncidents(message.guild.id, { status: "all", limit: 50 }).find((item) => item.incidentId === match[1] || item.incidentId.startsWith(match[1]));
        if (!incident) throw new Error("Incident introuvable.");
        const updated = assignSysPlusIncident(message.guild.id, incident.incidentId, message.author.id, userId, { authorizeActor });
        recordSysPlusAudit(message.guild.id, message.author.id, "incident.assign", incident.incidentId, { assigneeId: userId });
        audit(message.guild, "SYS+ — incident assigné", `Incident : \`${incident.incidentId.slice(0, 8)}\`\nAssigné par : <@${message.author.id}>\nResponsable : <@${userId}>`);
        await message.reply(`👤 Incident \`${incident.incidentId.slice(0, 8)}\` assigné à <@${updated.assignedTo}>.`);
        return true;
      }
      if (action === "report" || action === "rapport") {
        const token = args[2] ?? "";
        const matches = listSysPlusIncidents(message.guild.id, { status: "all", limit: 50 }).filter((item) => token.length >= 4 && (item.incidentId === token || item.incidentId.startsWith(token)));
        if (matches.length !== 1) throw new Error("Incident introuvable ou identifiant ambigu (au moins 4 caractères).");
        const report = buildSysPlusIncidentReport(message.guild.id, matches[0].incidentId);
        recordSysPlusAudit(message.guild.id, message.author.id, "incident.report", matches[0].incidentId, {});
        await message.reply({ content: `📄 Rapport de l'incident \`${matches[0].incidentId.slice(0, 8)}\`.`, files: [new AttachmentBuilder(Buffer.from(report, "utf8"), { name: `incident-${matches[0].incidentId.slice(0, 8)}.md` })], allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "resolve") {
        const payload = message.content.replace(/^=sysp\s+incident\s+resolve\s+/i, "");
        const [token, ...resolution] = payload.split("|").map((part) => part.trim());
        const incident = listSysPlusIncidents(message.guild.id, { status: "all", limit: 50 }).find((item) => item.incidentId === token || item.incidentId.startsWith(token));
        if (!incident) throw new Error("Incident introuvable ou identifiant ambigu.");
        const updated = resolveSysPlusIncident(message.guild.id, incident.incidentId, message.author.id, resolution.join(" | "), { authorizeActor });
        recordSysPlusAudit(message.guild.id, message.author.id, "incident.resolve", incident.incidentId, { resolution: updated.resolution });
        audit(message.guild, "SYS+ — incident résolu", `Incident : \`${incident.incidentId.slice(0, 8)}\`\nRésolu par : <@${message.author.id}>\nRésolution : ${updated.resolution}`);
        await message.reply(`✅ Incident \`${incident.incidentId.slice(0, 8)}\` résolu.`);
        return true;
      }
      if (action === "status") {
        const incident = listSysPlusIncidents(message.guild.id, { status: "all", limit: 50 }).find((item) => item.incidentId === args[2] || item.incidentId.startsWith(args[2] ?? ""));
        if (!incident) throw new Error("Incident introuvable ou identifiant ambigu.");
        const updated = updateSysPlusIncidentStatus(message.guild.id, incident.incidentId, message.author.id, args[3], { authorizeActor });
        recordSysPlusAudit(message.guild.id, message.author.id, "incident.status", incident.incidentId, { status: updated.status });
        audit(message.guild, "SYS+ — statut incident modifié", `Incident : \`${incident.incidentId.slice(0, 8)}\`\nModifié par : <@${message.author.id}>\nStatut : **${updated.status}**`);
        await message.reply(`ℹ️ Incident \`${incident.incidentId.slice(0, 8)}\` : **${updated.status}**.`);
        return true;
      }
      throw new Error("Utilise `=sysp incident create`, `list`, `show <id>`, `assign <id> <@membre>`, `status <id> in_progress` ou `resolve <id> | résolution`.");
    } catch (error) {
      await message.reply(`❌ ${error instanceof Error ? error.message : "Opération incident impossible."}`);
      return true;
    }
  }

  if (args[0]?.toLowerCase() === "market") {
    return handleMarketPrefix(message, args.slice(1), { roleId, configuredOwners: process.env.PND_OWNER_DISCORD_ID });
  }
  if (args[0]?.toLowerCase() === "studio") {
    return handleStudioPrefix(message, args.slice(1), { roleId, client: message.client });
  }
  if (args[0]?.toLowerCase() === "pack") {
    return handlePackPrefix(message, args.slice(1), { configuredOwners: process.env.PND_OWNER_DISCORD_ID });
  }
  if (args[0]?.toLowerCase() === "clone") {
    try {
      const text = await runServerCloneAction({
        guild: message.guild, member: message.member, actorId: message.author.id, roleId,
        action: args[1], blueprintRef: args[2], token: args[3], record,
      });
      await message.reply(text);
    } catch (error) {
      await message.reply(`❌ ${error instanceof Error ? error.message : "Server Clone impossible."}`);
    }
    return true;
  }

  if (args[0]?.toLowerCase() === "blueprint") {
    const action = (args[1] ?? "list").toLowerCase();
    try {
      if (action === "create") {
        await Promise.all([message.guild.roles.fetch(), message.guild.channels.fetch()]);
        const result = createGuildBlueprint(message.guild, args.slice(2).join(" "), message.author.id, { authorizeActor: ({ actorId }) => actorId === message.author.id && isSysPlus(message.member, roleId) });
        recordSysPlusAudit(message.guild.id, message.author.id, "sysplus.blueprint.create", result.blueprintId, { name: result.name, roles: result.roleCount, channels: result.channelCount, checksum: result.checksum });
        record("sysplus_blueprint_created");
        await message.reply(`✅ Blueprint **${result.name}** créé : \`${result.blueprintId.slice(0, 8)}\` · ${result.roleCount} rôles · ${result.channelCount} salons. Aucun membre ni message n'a été sauvegardé.`);
        return true;
      }
      if (action === "list") {
        const rows = listGuildBlueprints(message.guild.id);
        await message.reply(rows.length ? `**Blueprints PND**\n${rows.map((row) => `• \`${row.blueprintId.slice(0, 8)}\` — ${row.name} · <t:${Math.floor(row.createdAt / 1000)}:R>`).join("\n")}` : "Aucun blueprint sauvegardé.");
        return true;
      }
      if (action === "export") {
        const token = args[2] ?? "";
        const rows = listGuildBlueprints(message.guild.id);
        const matches = rows.filter((row) => row.blueprintId === token || row.blueprintId.startsWith(token));
        if (matches.length !== 1) throw new Error("Identifiant de blueprint introuvable ou ambigu.");
        const blueprint = getGuildBlueprintSnapshot(message.guild.id, matches[0].blueprintId);
        const filename = `pnd-blueprint-${matches[0].blueprintId.slice(0, 8)}.json`;
        await message.reply({ content: `📦 Export du blueprint **${blueprint.name}**.`, files: [{ attachment: Buffer.from(JSON.stringify(blueprint.snapshot, null, 2)), name: filename }], allowedMentions: { parse: [] } });
        recordSysPlusAudit(message.guild.id, message.author.id, "sysplus.blueprint.export", matches[0].blueprintId, { checksum: blueprint.checksum });
        return true;
      }
      if (action === "compare") {
        await Promise.all([message.guild.roles.fetch(), message.guild.channels.fetch()]);
        const token = args[2] ?? "";
        const rows = listGuildBlueprints(message.guild.id);
        const matches = rows.filter((row) => row.blueprintId === token || row.blueprintId.startsWith(token));
        if (matches.length !== 1) throw new Error("Identifiant de blueprint introuvable ou ambigu.");
        const diff = compareGuildBlueprint(message.guild, matches[0].blueprintId);
        const summary = (label, data) => `${label} : +${data.added.length} / −${data.removed.length} / ~${data.modified.length}`;
        await message.reply(`**Comparaison Time Machine — ${matches[0].name}**\n${summary("Rôles", diff.roles)}\n${summary("Salons", diff.channels)}\nAucune modification n'a été appliquée au serveur.`);
        return true;
      }
      throw new Error("Utilise `=sysp blueprint create <nom>`, `list`, `compare <id>` ou `export <id>`.");
    } catch (error) {
      await message.reply(`❌ ${error instanceof Error ? error.message : "Opération blueprint impossible."}`);
      return true;
    }
  }

  if (args[0]?.toLowerCase() === "audit") {
    // =sysp audit [@membre|ID] [début d'action]
    const memberArg = args.slice(1).map((a) => /^<@!?(\d{17,20})>$|^(\d{17,20})$/.exec(a)).find(Boolean);
    const memberId = memberArg ? memberArg[1] ?? memberArg[2] : null;
    const actionArg = args.slice(1).find((a) => !/^<@!?\d{17,20}>$|^\d{17,20}$/.test(a)) ?? null;
    const rows = listSysPlusAudit(message.guild.id, memberId || actionArg ? 25 : 10, { memberId, action: actionArg });
    const lines = rows.map((row) => `• <t:${Math.floor(row.createdAt / 1000)}:R> — \`${row.action}\` par <@${row.actorId}>${row.targetId ? ` → ${row.targetId}` : ""}`);
    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe21d2f)
        .setTitle("🧾 Audit SYS+")
        .setDescription(lines.length ? lines.join("\n") : "Aucune action enregistrée.")
        .setFooter({ text: "Journal local du serveur, limité aux dix dernières actions." })],
      allowedMentions: { parse: [] },
    });
    return true;
  }

  const embed = themePanelEmbed(new EmbedBuilder()
    .setTitle("🌙 SYS+ — Centre de contrôle")
    .setDescription("Centre de contrôle des privilèges et de l’activité staff de ce serveur.")
    .addFields(
      { name: "Serveur", value: message.guild.name, inline: true },
      { name: "Rôle Perm Sys+", value: roleId ? `<@&${roleId}>` : "Non configuré", inline: true },
      { name: "Rôle ADMIN+", value: getAdminPlusRoleId(message.guild.id) ? `<@&${getAdminPlusRoleId(message.guild.id)}>` : "Non configuré", inline: true },
      { name: "Commandes disponibles", value: "`/sysp panel` — ouvrir ce panneau\n`/sysp audit` — historique SYS+\n`/sysp add` / `/sysp remove` — gérer SYS+ (propriétaire)\n`/sysp permissions` / `/sysp permissions-edit` — scopes ADMIN+ (propriétaire ou administrateur)\n`/sysp whitelist-add|whitelist-remove|whitelist-list` — gérer WHITELIST (propriétaire)\n`=sysp role @Rôle` / `=sysp admin-role @Rôle` — configurer les rôles\n`/sysp supervisor-set` / `supervisor-remove` / `supervisor-list` — gérer les responsables staff\n`/sysp blueprint` — Time Machine : sauvegarder, comparer et exporter la structure serveur\n`/sysp incident` — Centre d’incidents SYS+\n`=sysp composer` — procédures staff réutilisables\n`=sysp search <termes>` — recherche dans les données SYS+\n`/sysp intelligence-channel` / `intelligence-toggle` — configurer PND Intelligence" },
      { name: "Modules disponibles", value: "Tickets staff : actifs\nCommandes vocales `=access` / `=panel` / `=pv` : actives\nDOG, flux audio autorisés et mini-jeux : actifs" },
      { name: "Portée des privilèges", value: "ADMIN+ reste limité aux scopes configurés. SYS+, WHITELIST et les permissions natives Discord gardent leurs contrôles indépendants." }
    )
    .setFooter({ text: "FWU • Centre de contrôle SYS+" }), { thumbnailUrl: herBotAvatar(message.guild) });
  await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  return true;
}

export async function handleSysPlusInteraction(interaction, settings, { apiUrl, secret, record, audit = () => {} }) {
  if (!interaction.isChatInputCommand() || !["sysp", "sys-panel", "sys-add", "sys-remove", "action-history", "permissions", "permissions-edit"].includes(interaction.commandName)) return false;

  const subcommand = interaction.commandName === "sysp"
    ? interaction.options.getSubcommand()
    : ({ "sys-panel": "panel", "sys-add": "add", "sys-remove": "remove", "action-history": "audit", permissions: "permissions", "permissions-edit": "permissions-edit" })[interaction.commandName];
  const guild = interaction.guild;

  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
    return true;
  }

  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "❌ Impossible d’actualiser ton profil serveur. Réessaie.", ephemeral: true });
    return true;
  }
  const roleId = settings?.[guild.id]?.sysPlus?.roleId ?? null;

  if (subcommand === "gel" || subcommand === "degel") {
    return handleFreezeCommand(interaction, { bot: process.env.PND_BOT_PROFILE || "fwu", audit });
  }
  if (subcommand === "fiche") {
    const ownerOfBot = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
    return handleMemberCardCommand(interaction, { member, roleId, isSysPlus, isOwner: Boolean(ownerOfBot) && interaction.user.id === ownerOfBot });
  }
  if (subcommand === "stats") {
    const ownerOfBot = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
    return handleStaffStatsCommand(interaction, { member, roleId, isSysPlus, isOwner: Boolean(ownerOfBot) && interaction.user.id === ownerOfBot, settings });
  }
  if (subcommand === "alerte-abus") {
    return handleAbuseAlertCommand(interaction, { bot: process.env.PND_BOT_PROFILE || "fwu", member, roleId, isSysPlus, audit });
  }
  if (subcommand === "clone") {
    try {
      const text = await runServerCloneAction({
        guild, member, actorId: interaction.user.id, roleId,
        action: interaction.options.getString("action", true),
        blueprintRef: interaction.options.getString("blueprint", true),
        token: interaction.options.getString("jeton"),
        record,
      });
      await interaction.reply({ content: text, ephemeral: true, allowedMentions: { parse: [] } });
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Server Clone impossible."}`, ephemeral: true });
    }
    return true;
  }

  if (DIAGNOSTIC_ACTIONS.has(subcommand)) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const text = await runSysPlusDiagnostic(guild, member, roleId, subcommand, record, settings?.[guild.id]?.sysPlus?.whitelistRoleId ?? null);
      await interaction.editReply({ content: text.slice(0, 1990), allowedMentions: { parse: [] } });
    } catch (error) {
      await interaction.editReply({ content: error instanceof Error ? error.message : "Diagnostic impossible." });
    }
    return true;
  }

  if (subcommand === "studio") {
    return handleStudioInteraction(interaction, { roleId, client: interaction.client });
  }

  if (subcommand === "ghost") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }
    const openIncidents = listSysPlusIncidents(guild.id, { status: "all", limit: 20 });
    const active = openIncidents.filter((item) => item.status !== "resolved");
    const critical = active.filter((item) => item.severity === "critical" || item.severity === "high");
    const auditRows = listSysPlusAudit(guild.id, 5);
    recordSysPlusAudit(guild.id, member.id, "ghost.private_consultation", null, { activeIncidents: active.length });
    const embed = new EmbedBuilder()
      .setColor(0x475569)
      .setTitle("👻 Ghost Mode — consultation privée")
      .setDescription("Vue staff éphémère et en lecture seule. Aucun message privé, contenu de conversation ou activité invisible des membres n'est collecté. Cette consultation est journalisée.")
      .addFields(
        { name: "Incidents actifs", value: String(active.length), inline: true },
        { name: "Incidents élevés / critiques", value: String(critical.length), inline: true },
        { name: "Dernières actions SYS+", value: auditRows.length ? auditRows.map((row) => `• \`${row.action}\` — <t:${Math.floor(row.createdAt / 1000)}:R>`).join("\n") : "Aucune action récente." },
      )
      .setFooter({ text: "FWU • Privé ne signifie pas invisible : accès audité, aucune surveillance des membres." });
    await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }

  if (subcommand === "composer" || subcommand === "search") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }
    const authorizeActor = ({ guildId, actorId }) => guildId === guild.id && actorId === member.id && isSysPlus(member, roleId);
    try {
      if (subcommand === "search") {
        const query = interaction.options.getString("requete", true);
        const results = searchSysPlusWorkspace(guild.id, query, { limit: 8 });
        const lines = results.map((item) => `• **[${item.type}] ${item.title}** — ${item.summary.slice(0, 180)}`);
        await interaction.reply({ content: results.length ? `🔎 **Smart Search**\n${lines.join("\n")}` : "Aucun résultat dans les données SYS+.", ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      const action = interaction.options.getString("action", true);
      if (action === "create") {
        const item = createCommandbook(guild.id, member.id, {
          name: interaction.options.getString("nom", true),
          description: interaction.options.getString("description", true),
          body: interaction.options.getString("contenu", true),
        }, { authorizeActor });
        recordSysPlusAudit(guild.id, member.id, "commandbook.create", item.id, { name: item.name });
        await interaction.reply({ content: `🧩 Runbook **${item.name}** enregistré. Il documente une procédure et n'exécute aucune action Discord.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "list") {
        const rows = listCommandbooks(guild.id, 20);
        await interaction.reply({ content: rows.length ? rows.map((item) => `• \`${item.name}\` — ${item.description}`).join("\n") : "Aucun runbook enregistré.", ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      const name = interaction.options.getString("nom", true);
      if (action === "show") {
        const item = getCommandbook(guild.id, name);
        if (!item) throw new Error("Runbook introuvable.");
        await interaction.reply({ content: `**${item.name}**\n${item.description}\n\n${item.body.slice(0, 1800)}`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "delete") {
        const item = deleteCommandbook(guild.id, member.id, name, { authorizeActor });
        recordSysPlusAudit(guild.id, member.id, "commandbook.delete", item.id, { name: item.name });
        await interaction.reply({ content: `🗑️ Runbook **${item.name}** supprimé.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      throw new Error("Action Command Composer inconnue.");
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Opération SYS+ impossible."}`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
  }

  if (subcommand === "incident") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }
    const action = interaction.options.getString("action", true);
    const authorizeActor = ({ guildId, actorId }) => guildId === guild.id && actorId === member.id && isSysPlus(member, roleId);
    try {
      if (action === "create") {
        const incident = createSysPlusIncident(guild.id, member.id, { title: interaction.options.getString("titre", true), summary: interaction.options.getString("resume", true), severity: interaction.options.getString("gravite", true) }, { authorizeActor });
        recordSysPlusAudit(guild.id, member.id, "incident.create", incident.incidentId, { severity: incident.severity, title: incident.title });
        audit(guild, "SYS+ — incident créé", `Créé par : <@${member.id}>\nGravité : **${incident.severity}**\nTitre : **${incident.title}**\nRéférence : \`${incident.incidentId.slice(0, 8)}\``);
        await interaction.reply({ content: `🚨 Incident **${incident.title}** créé · **${incident.severity}** · \`${incident.incidentId.slice(0, 8)}\`.`, ephemeral: true });
        return true;
      }
      if (action === "list") {
        const incidents = listSysPlusIncidents(guild.id, { status: "all", limit: 10 });
        await interaction.reply({ content: incidents.length ? `**Centre d'incidents SYS+**\n${incidents.map((item) => `• \`${item.incidentId.slice(0, 8)}\` · **${item.severity}** · ${item.status} · ${item.title}`).join("\n")}` : "Aucun incident enregistré.", ephemeral: true });
        return true;
      }
      const token = interaction.options.getString("id", true);
      const matches = listSysPlusIncidents(guild.id, { status: "all", limit: 50 }).filter((item) => item.incidentId === token || item.incidentId.startsWith(token));
      if (action === "show") {
        if (matches.length !== 1) throw new Error("Incident introuvable ou identifiant ambigu.");
        const item = matches[0];
        await interaction.reply({ content: `**${item.title}** · ${item.severity} · ${item.status}\n${item.summary}\nCréé par <@${item.createdBy}>${item.assignedTo ? ` · Assigné à <@${item.assignedTo}>` : " · Non assigné"}${item.resolution ? `\nRésolution : ${item.resolution}` : ""}`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (matches.length !== 1) throw new Error("Incident introuvable ou identifiant ambigu.");
      if (action === "report") {
        const report = buildSysPlusIncidentReport(guild.id, matches[0].incidentId);
        recordSysPlusAudit(guild.id, member.id, "incident.report", matches[0].incidentId, {});
        await interaction.reply({ content: `📄 Rapport de l'incident \`${matches[0].incidentId.slice(0, 8)}\`.`, files: [new AttachmentBuilder(Buffer.from(report, "utf8"), { name: `incident-${matches[0].incidentId.slice(0, 8)}.md` })], ephemeral: true });
        return true;
      }
      if (action === "assign") {
        const target = interaction.options.getUser("membre", true);
        const guildMember = await guild.members.fetch(target.id).catch(() => null);
        if (!guildMember || guildMember.user.bot) throw new Error("Le responsable doit être un membre humain du serveur.");
        const targetIsStaff = isSysPlus(guildMember, roleId) || isAdminPlus(guildMember, roleId, getAdminPlusRoleId(guild.id)) || guildMember.permissions.has(PermissionFlagsBits.ManageGuild) || guildMember.permissions.has(PermissionFlagsBits.Administrator);
        if (!targetIsStaff) throw new Error("Le responsable doit appartenir au staff SYS+/ADMIN+ ou disposer des permissions Discord de gestion.");
        const updated = assignSysPlusIncident(guild.id, matches[0].incidentId, member.id, target.id, { authorizeActor });
        recordSysPlusAudit(guild.id, member.id, "incident.assign", updated.incidentId, { assigneeId: target.id });
        audit(guild, "SYS+ — incident assigné", `Incident : \`${updated.incidentId.slice(0, 8)}\`\nAssigné par : <@${member.id}>\nResponsable : <@${target.id}>`);
        await interaction.reply({ content: `👤 Incident assigné à <@${target.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "resolve") {
        const updated = resolveSysPlusIncident(guild.id, matches[0].incidentId, member.id, interaction.options.getString("resolution", true), { authorizeActor });
        recordSysPlusAudit(guild.id, member.id, "incident.resolve", updated.incidentId, { resolution: updated.resolution });
        audit(guild, "SYS+ — incident résolu", `Incident : \`${updated.incidentId.slice(0, 8)}\`\nRésolu par : <@${member.id}>\nRésolution : ${updated.resolution}`);
        await interaction.reply({ content: "✅ Incident résolu.", ephemeral: true });
        return true;
      }
      const status = interaction.options.getString("statut", true);
      const updated = updateSysPlusIncidentStatus(guild.id, matches[0].incidentId, member.id, status, { authorizeActor });
      recordSysPlusAudit(guild.id, member.id, "incident.status", updated.incidentId, { status });
      audit(guild, "SYS+ — statut incident modifié", `Incident : \`${updated.incidentId.slice(0, 8)}\`\nModifié par : <@${member.id}>\nStatut : **${updated.status}**`);
      await interaction.reply({ content: `ℹ️ Incident : **${updated.status}**.`, ephemeral: true });
      return true;
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Opération incident impossible."}`, ephemeral: true });
      return true;
    }
  }

  if (subcommand === "blueprint") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }
    const action = interaction.options.getString("action", true);
    try {
      if (action === "create") {
        await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
        const result = createGuildBlueprint(guild, interaction.options.getString("nom", true), member.id, { authorizeActor: () => isSysPlus(member, roleId) });
        recordSysPlusAudit(guild.id, member.id, "sysplus.blueprint.create", result.blueprintId, { name: result.name, roles: result.roleCount, channels: result.channelCount, checksum: result.checksum });
        record("sysplus_blueprint_created");
        await interaction.reply({ content: `✅ Blueprint **${result.name}** créé : \`${result.blueprintId.slice(0, 8)}\` · ${result.roleCount} rôles · ${result.channelCount} salons. Aucun membre ni message n'a été sauvegardé.`, ephemeral: true });
        return true;
      }
      if (action === "list") {
        const rows = listGuildBlueprints(guild.id);
        await interaction.reply({ content: rows.length ? `**Blueprints PND**\n${rows.map((row) => `• \`${row.blueprintId.slice(0, 8)}\` — ${row.name} · <t:${Math.floor(row.createdAt / 1000)}:R>`).join("\n")}` : "Aucun blueprint sauvegardé.", ephemeral: true });
        return true;
      }
      const token = interaction.options.getString("id", true);
      const matches = listGuildBlueprints(guild.id).filter((row) => row.blueprintId === token || row.blueprintId.startsWith(token));
      if (matches.length !== 1) throw new Error("Identifiant de blueprint introuvable ou ambigu.");
      if (action === "export") {
        const blueprint = getGuildBlueprintSnapshot(guild.id, matches[0].blueprintId);
        const filename = `pnd-blueprint-${matches[0].blueprintId.slice(0, 8)}.json`;
        await interaction.reply({ content: `📦 Export du blueprint **${blueprint.name}**.`, files: [new AttachmentBuilder(Buffer.from(JSON.stringify(blueprint.snapshot, null, 2)), { name: filename })], ephemeral: true });
        recordSysPlusAudit(guild.id, member.id, "sysplus.blueprint.export", matches[0].blueprintId, { checksum: blueprint.checksum });
        return true;
      }
      await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
      const diff = compareGuildBlueprint(guild, matches[0].blueprintId);
      await interaction.reply({ content: `**Comparaison Time Machine — ${matches[0].name}**\nRôles : +${diff.roles.added.length} / −${diff.roles.removed.length} / ~${diff.roles.modified.length}\nSalons : +${diff.channels.added.length} / −${diff.channels.removed.length} / ~${diff.channels.modified.length}\nAucune modification n'a été appliquée au serveur.`, ephemeral: true });
      return true;
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Opération blueprint impossible."}`, ephemeral: true });
      return true;
    }
  }

  if (subcommand === "intelligence-channel" || subcommand === "intelligence-toggle") {
    if (!canConfigureSysPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut configurer PND Intelligence.", ephemeral: true });
      return true;
    }
    const current = settings?.[guild.id]?.sysPlus ?? {};
    let channelId = current.intelligenceChannelId ?? null;
    let enabled = current.intelligenceEnabled === true;
    if (subcommand === "intelligence-channel") {
      const channel = interaction.options.getChannel("salon", true);
      if (channel.guildId !== guild.id || !channel.isTextBased?.() || !channel.send) {
        await interaction.reply({ content: "❌ Choisis un salon texte de ce serveur.", ephemeral: true });
        return true;
      }
      const bot = await guild.members.fetchMe().catch(() => null);
      const permissions = bot ? channel.permissionsFor(bot) : null;
      if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages)) {
        await interaction.reply({ content: "❌ Le bot doit pouvoir voir ce salon et y envoyer des messages.", ephemeral: true });
        return true;
      }
      channelId = channel.id;
    } else {
      enabled = interaction.options.getBoolean("etat", true);
      if (enabled && !channelId) {
        await interaction.reply({ content: "Configure d’abord le salon avec /sysp intelligence-channel.", ephemeral: true });
        return true;
      }
    }
    try {
      const response = await fetch(apiUrl, {
        method: "POST", headers: AUTH(secret), signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ action: "set-sysplus-intelligence", guildId: guild.id, actorId: interaction.user.id, intelligenceEnabled: enabled, intelligenceChannelId: channelId }),
      });
      const payload = await readSyncResponse(response);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(describeIntelligenceSyncFailure(response.status, payload));
      }
      // Only mutate the bot cache after the dashboard confirms persistence.
      settings[guild.id] ??= {};
      settings[guild.id].sysPlus = { ...(settings[guild.id].sysPlus ?? {}), intelligenceEnabled: enabled, intelligenceChannelId: channelId };
      recordSysPlusAudit(guild.id, interaction.user.id, "sysplus.intelligence.configure", channelId, { enabled });
      record("sysplus_intelligence_configured");
      const status = enabled ? "activée" : "désactivée";
      const destination = channelId ? ` dans <#${channelId}>` : "";
      await interaction.reply({
        content: `✅ PND Intelligence ${status}${destination}. Accès réservé au rôle SYS+ et aux propriétaires PND configurés.${payload.auditRecorded === false ? " ⚠️ La configuration est enregistrée, mais l’audit SYS+ n’a pas pu être écrit." : ""}`,
        ephemeral: true, allowedMentions: { parse: [] },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Erreur inconnue";
      console.error("[SYS+] PND Intelligence settings save failed:", reason);
      record("sysplus_intelligence_save_failed");
      await respondInPlaceSafe(interaction, { content: `❌ Impossible d’enregistrer la configuration PND Intelligence.
${reason}`, ephemeral: true });
    }
    return true;
  }

  if (["supervisor-set", "supervisor-remove", "supervisor-list"].includes(subcommand)) {
    if (!canConfigureSysPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut gérer cette configuration.", ephemeral: true });
      return true;
    }

    if (subcommand === "supervisor-list") {
      const relations = listStaffSupervisors(guild.id);
      const lines = relations.slice(0, 40).map((relation) =>
        `• <@${relation.staffUserId}> → <@${relation.supervisorUserId}> · modifié <t:${Math.floor(relation.updatedAt / 1000)}:R>`,
      );
      await interaction.reply({
        content: lines.length
          ? `**Hiérarchie du staff — ${guild.name}**\n${lines.join("\n")}`
          : "Aucun responsable hiérarchique n'est configuré. Les logs afficheront « Responsable non configuré ».",
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const staffUser = interaction.options.getUser("membre", true);
    if (subcommand === "supervisor-remove") {
      const existing = getStaffSupervisor(guild.id, staffUser.id);
      if (!existing) {
        await interaction.reply({ content: `Aucun responsable n'est configuré pour <@${staffUser.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      removeStaffSupervisor({ guildId: guild.id, staffUserId: staffUser.id });
      recordSysPlusAudit(guild.id, member.id, "staff.supervisor.remove", staffUser.id, { previousSupervisorId: existing.supervisorUserId });
      audit(guild, "STAFF — responsable retiré", `Configuré par : <@${member.id}>\nMembre du staff : <@${staffUser.id}>\nAncien responsable : <@${existing.supervisorUserId}>`);
      record("staff_supervisor_removed");
      await interaction.reply({ content: `✅ Responsable retiré pour <@${staffUser.id}>. Les prochaines sanctions afficheront « Responsable non configuré » tant qu'aucun responsable ne sera défini.`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }

    const supervisorUser = interaction.options.getUser("responsable", true);
    const [staffMember, supervisorMember] = await Promise.all([
      guild.members.fetch({ user: staffUser.id, force: true }).catch(() => null),
      guild.members.fetch({ user: supervisorUser.id, force: true }).catch(() => null),
    ]);
    if (!staffMember || !supervisorMember) {
      await interaction.reply({ content: "❌ Le membre du staff et son responsable doivent appartenir à ce serveur.", ephemeral: true });
      return true;
    }
    if (staffMember.id === guild.ownerId) {
      await interaction.reply({ content: "❌ Le propriétaire du serveur est au sommet de la hiérarchie et ne peut pas recevoir de responsable.", ephemeral: true });
      return true;
    }

    try {
      const previous = getStaffSupervisor(guild.id, staffMember.id);
      const relation = setStaffSupervisor({
        guildId: guild.id,
        staffUserId: staffMember.id,
        supervisorUserId: supervisorMember.id,
        updatedBy: member.id,
        guildOwnerId: guild.ownerId,
      });
      recordSysPlusAudit(guild.id, member.id, "staff.supervisor.set", staffMember.id, {
        supervisorId: supervisorMember.id,
        previousSupervisorId: previous?.supervisorUserId ?? null,
      });
      audit(guild, "STAFF — responsable configuré", `Configuré par : <@${member.id}>\nMembre du staff : <@${staffMember.id}>\nResponsable : <@${supervisorMember.id}>`);
      record("staff_supervisor_set");
      await interaction.reply({
        content: `✅ <@${relation.staffUserId}> dépend désormais de <@${relation.supervisorUserId}>. Ce responsable sera mentionné dans les journaux de sanction.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Attribution impossible."}`, ephemeral: true });
    }
    return true;
  }

  if (subcommand === "permissions" || subcommand === "permissions-edit") {
    if (!canConfigureAdminPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut consulter et modifier les permissions ADMIN+.", ephemeral: true });
      return true;
    }
    if (subcommand === "permissions") {
      const lines = Object.entries(ADMIN_PLUS_SCOPES).map(([scope, definition]) => {
        const enabled = getAdminPlusScope(guild.id, scope);
        return `${enabled ? "✅" : "⛔"} **${definition.label}** — ${enabled ? "autorisée" : "refusée"}${enabled === definition.defaultEnabled ? " (valeur par défaut)" : " (personnalisée)"}`;
      });
      await interaction.reply({ content: `**Permissions du rôle ADMIN+ — ${guild.name}**\n${lines.join("\n")}\n\nModifie un module avec \`/sysp permissions-edit\`. SYS+ et les permissions natives Discord gardent leur accès propre.`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    const scope = interaction.options.getString("module", true);
    const enabled = interaction.options.getBoolean("autorise", true);
    if (!ADMIN_PLUS_SCOPES[scope]) {
      await interaction.reply({ content: "Module de permissions inconnu.", ephemeral: true });
      return true;
    }
    setAdminPlusScope(guild.id, scope, enabled, member.id);
    recordSysPlusAudit(guild.id, member.id, "adminplus.permission.update", scope, { enabled });
    audit(guild, "ADMIN+ — permission modifiée", `Propriétaire/admin : <@${member.id}>\nModule : **${ADMIN_PLUS_SCOPES[scope].label}**\nAccès : ${enabled ? "autorisé" : "refusé"}`);
    record("adminplus_permission_updated");
    await interaction.reply({ content: `✅ Accès ADMIN+ **${enabled ? "autorisé" : "refusé"}** pour **${ADMIN_PLUS_SCOPES[scope].label}** sur ce serveur.`, ephemeral: true });
    return true;
  }

  if (subcommand === "add" || subcommand === "remove") {
    if (!canConfigureSysPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut attribuer ou retirer SYS+.", ephemeral: true });
      return true;
    }
    const ownerId = String(process.env.PND_OWNER_DISCORD_ID ?? "").trim();
    if (!roleId) {
      await interaction.reply({ content: "Configure d’abord le rôle Perm SYS+ avec `/sysp role`.", ephemeral: true });
      return true;
    }
    const targetUser = interaction.options.getUser("membre", true);
    const [target, role, bot] = await Promise.all([
      guild.members.fetch({ user: targetUser.id, force: true }).catch(() => null),
      guild.roles.fetch(roleId, { force: true }).catch(() => null),
      guild.members.fetchMe({ force: true }).catch(() => null),
    ]);
    if (!target || !role || role.managed || role.id === guild.id) {
      await interaction.reply({ content: "❌ Membre ou rôle SYS+ introuvable ou non modifiable.", ephemeral: true });
      return true;
    }
    const decision = sysMemberActionDecision({
      actorId: member.id,
      ownerId,
      targetId: target.id,
      actorPosition: member.roles.highest.position,
      targetPosition: target.roles.highest.position,
      roleId: role.id,
      everyoneRoleId: guild.id,
      rolePosition: role.position,
      roleManaged: role.managed,
      botId: bot?.id,
      botPosition: bot?.roles.highest.position ?? 0,
      hasManageRoles: Boolean(bot?.permissions.has(PermissionFlagsBits.ManageRoles)),
    });
    if (!decision.allowed) {
      await interaction.reply({ content: `❌ ${decision.reason}`, ephemeral: true });
      return true;
    }
    const hasRole = target.roles.cache.has(role.id);
    if ((subcommand === "add" && hasRole) || (subcommand === "remove" && !hasRole)) {
      await interaction.reply({ content: subcommand === "add" ? "Ce membre possède déjà SYS+." : "Ce membre ne possède pas SYS+.", ephemeral: true });
      return true;
    }
    if (subcommand === "add") await target.roles.add(role, `SYS+ attribué par le propriétaire ${member.id}`);
    else await target.roles.remove(role, `SYS+ retiré par le propriétaire ${member.id}`);
    const action = subcommand === "add" ? "sysplus.member.add" : "sysplus.member.remove";
    recordSysPlusAudit(guild.id, member.id, action, target.id, { roleId: role.id });
    audit(guild, "SYS+ — privilège modifié", `Propriétaire : <@${member.id}>\nMembre : <@${target.id}>\nAction : ${subcommand}`);
    record(action.replaceAll(".", "_"));
    await interaction.reply({ content: subcommand === "add" ? `✅ SYS+ attribué à <@${target.id}>.` : `✅ SYS+ retiré à <@${target.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }

  if (subcommand === "admin-role") {
    if (!canConfigureAdminPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut configurer ADMIN+.", ephemeral: true });
      return true;
    }
    const role = interaction.options.getRole("role", true);
    if (role.managed || role.id === guild.id) {
      await interaction.reply({ content: "❌ Ce rôle ne peut pas être utilisé.", ephemeral: true });
      return true;
    }
    setAdminPlusRoleId(guild.id, role.id, interaction.user.id);
    recordSysPlusAudit(guild.id, interaction.user.id, "adminplus.role.update", role.id, { name: role.name });
    record("adminplus_role_updated");
    await interaction.reply({ content: `✅ **${role.name}** est maintenant le rôle ADMIN+ du serveur.`, ephemeral: true });
    return true;
  }

  if (subcommand === "whitelist-role") {
    if (!canConfigureSysPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut configurer le rôle WHITELIST.", ephemeral: true });
      return true;
    }
    const role = interaction.options.getRole("role", true);
    const bot = await guild.members.fetchMe({ force: true });
    if (!bot.permissions.has(PermissionFlagsBits.ManageRoles) || !isValidWhitelistRole(role, guild.id, bot.roles.highest.position)) {
      await interaction.reply({ content: "❌ Choisis le rôle exact `WHITELIST`, non géré et placé sous le rôle le plus élevé du bot. Le bot doit avoir Gérer les rôles.", ephemeral: true });
      return true;
    }
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: AUTH(secret),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ action: "set-whitelist-role", guildId: guild.id, roleId: role.id, actorId: member.id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      settings[guild.id] ??= {};
      settings[guild.id].sysPlus = { ...(settings[guild.id].sysPlus ?? {}), whitelistRoleId: role.id };
      recordSysPlusAudit(guild.id, member.id, "whitelist.role.update", role.id, { name: role.name });
      record("whitelist_role_updated");
      audit(guild, "WHITELIST — rôle configuré", `Propriétaire : <@${member.id}>\nRôle : <@&${role.id}>`);
      await interaction.reply({ content: "✅ Le rôle WHITELIST est configuré pour ce serveur. Seul son propriétaire peut attribuer ou retirer le rôle.", ephemeral: true });
    } catch {
      await respondInPlaceSafe(interaction, { content: "❌ Impossible d’enregistrer le rôle WHITELIST.", ephemeral: true });
    }
    return true;
  }

  if (subcommand === "role") {
    if (!canConfigureSysPlus(member)) {
      await interaction.reply({ content: "⛔ Seul le Owner PND peut configurer ce rôle.", ephemeral: true });
      return true;
    }

    const role = interaction.options.getRole("role", true);

    if (role.managed || role.id === guild.id) {
      await interaction.reply({ content: "❌ Ce rôle ne peut pas être utilisé.", ephemeral: true });
      return true;
    }

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: AUTH(secret),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          action: "set-sysplus-role",
          guildId: guild.id,
          roleId: role.id,
          actorId: interaction.user.id,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      settings[guild.id] ??= {};
      settings[guild.id].sysPlus = { ...(settings[guild.id].sysPlus ?? {}), roleId: role.id };
      recordSysPlusAudit(guild.id, interaction.user.id, "sysplus.role.update", role.id, { name: role.name });
      record("sysplus_role_updated");

      await interaction.reply({
        content: `✅ Le rôle **${role.name}** est maintenant le rôle Perm SYS+.${result.auditRecorded === false ? " ⚠️ Audit non enregistré." : ""}`,
        ephemeral: true,
      });
    } catch {
      await respondInPlaceSafe(interaction, { content: "❌ Impossible d'enregistrer le rôle. Vérifie la synchronisation du site.", ephemeral: true });
    }

    return true;
  }

  if (subcommand === "panel") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }

    const embed = themePanelEmbed(new EmbedBuilder()
      .setTitle("🌙 SYS+ — Centre de contrôle")
      .setDescription("Le noyau SYS+ est actif.")
      .addFields(
        { name: "Serveur", value: guild.name, inline: true },
        { name: "Rôle Perm SYS+", value: roleId ? `<@&${roleId}>` : "Non configuré", inline: true },
        { name: "Rôle ADMIN+", value: getAdminPlusRoleId(guild.id) ? `<@&${getAdminPlusRoleId(guild.id)}>` : "Non configuré", inline: true },
        { name: "Commandes disponibles", value: "`/ticket` · `/sysp audit` · `=sysp admin-role @Rôle` · `/sysp whitelist-role` · `/sysp supervisor-set|supervisor-remove|supervisor-list` · `/sysp whitelist-*` (propriétaire) · `=access` · `=panel` · `=pv` · DOG · MENOTTE" },
        { name: "Modules disponibles", value: "Tickets staff, économie PND, social, cartes, vocal temporaire et jeux." }
      )
      .setFooter({ text: "FWU • Centre de contrôle SYS+" }), { thumbnailUrl: herBotAvatar(guild) });

    await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }

  if (subcommand === "audit") {
    if (!isSysPlus(member, roleId)) {
      await interaction.reply({ content: "⛔ Accès réservé au rôle Perm SYS+.", ephemeral: true });
      return true;
    }
    const memberFilter = interaction.options.getUser?.("membre")?.id ?? null;
    const actionFilter = interaction.options.getString?.("action")?.trim() || null;
    const rows = listSysPlusAudit(guild.id, memberFilter || actionFilter ? 25 : 10, { memberId: memberFilter, action: actionFilter });
    const lines = rows.map((row) => `• <t:${Math.floor(row.createdAt / 1000)}:R> — \`${row.action}\` par <@${row.actorId}>${row.targetId ? ` → ${row.targetId}` : ""}`);
    const filters = [memberFilter ? `membre <@${memberFilter}>` : null, actionFilter ? `action « ${actionFilter.slice(0, 40)} »` : null].filter(Boolean).join(", ");
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe21d2f)
        .setTitle(`🧾 Audit SYS+${filters ? ` · ${filters.replace(/<@\d+>/, "filtré")}` : ""}`.slice(0, 250))
        .setDescription((filters ? `Filtre : ${filters}\n` : "") + (lines.length ? lines.join("\n") : "Aucune action enregistrée.").slice(0, 3900))
        .setFooter({ text: filters ? "Journal local du serveur, 25 dernières actions correspondantes." : "Journal local du serveur, dix dernières actions. Filtre possible : membre, action." })],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  await interaction.reply({ content: "Sous-commande SYS+ inconnue.", ephemeral: true });
  return true;
}
