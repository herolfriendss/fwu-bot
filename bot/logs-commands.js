// FWU V2 — /logs et /dossier (SUCK ME, préfixe : =logs, =dossier).
// Recherche et dossiers : staff (canOpenDossier). Configuration du hub : OWNER seulement.
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { canOpenDossier } from "./reply-layer.js";
import { actionLabel, getCase, memberTimeline, searchLogs } from "./log-events.js";
import {
  addLogSource, alertRoleId, logRetentionDays, logSources, logSummaryFrequency, logsHubGuildId,
  removeLogSource, setAlertRoleId, setLogRetentionDays, setLogSourceEnabled, setLogSummaryFrequency, setLogsHub,
} from "./logs-config.js";
import { formatRelayLossLine, pendingRelayedLogs } from "./bot-runtime.js";
import { parseDurationToSeconds } from "./shared/sanctions.js";

const OWNER_SUBS = new Set(["hub", "source-ajouter", "source-activer", "source-retirer", "alertes", "conservation", "resume"]);

function isOwner(userId, env = process.env) {
  const owner = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  return Boolean(owner) && userId === owner;
}

function rowLine(row) {
  const when = `<t:${Math.floor(row.createdAt / 1000)}:R>`;
  const who = row.targetId ? ` → <@${row.targetId}>` : "";
  const by = row.actorId ? ` (par <@${row.actorId}>)` : "";
  const label = row.action ? actionLabel(row.action) : row.title ?? "Événement";
  return `${when} • ${label}${who}${by}${row.caseNumber ? ` • dossier #${row.caseNumber}` : ""}`.slice(0, 200);
}

/**
 * Cœur commun slash / préfixe. `request` = { guild, member, userId, sub, membreId, action,
 * periode, serveur, nom, libelle, actif, role, jours, frequence, numero, settings }.
 * Retourne un payload (visibilité privée : écran staff).
 */
export async function runLogsCommand(request, { now = Date.now(), env = process.env } = {}) {
  const { guild, member, userId, sub, settings } = request;
  const priv = (content) => ({ content, visibility: "private", allowedMentions: { parse: [] } });
  if (sub === "dossier") {
    if (!canOpenDossier(member, { settings, guildOwnerId: guild?.ownerId, env })) return priv("⛔ Les dossiers sont réservés au staff.");
    const record = getCase(guild.id, request.numero);
    if (!record) return priv(`⚠️ Dossier #${request.numero} introuvable sur ce serveur.`);
    return {
      visibility: "private",
      allowedMentions: { parse: [] },
      embeds: [{
        title: `📁 Dossier #${record.number} — ${actionLabel(record.action)}`,
        description: [
          `Acteur : ${record.actorId ? `<@${record.actorId}>` : "automatique"}`,
          `Cible : ${record.targetId ? `<@${record.targetId}>` : "—"}`,
          `Gravité : ${record.severity} • Catégorie : ${record.category}`,
          `Date : <t:${Math.floor(record.createdAt / 1000)}:f>`,
          record.reason ? `Raison : ${record.reason}` : null,
          record.details ? `Détails : ${record.details}` : null,
        ].filter(Boolean).join("\n").slice(0, 4000),
        fields: record.logs.length ? [{ name: "Journaux liés", value: record.logs.map((l) => `<t:${Math.floor(l.created_at / 1000)}:R> ${l.title ?? l.action}`).join("\n").slice(0, 1024) }] : [],
      }],
    };
  }
  if (OWNER_SUBS.has(sub) && !isOwner(userId, env)) return priv("⛔ La configuration des journaux est réservée à l'OWNER.");
  if (!OWNER_SUBS.has(sub) && !canOpenDossier(member, { settings, guildOwnerId: guild?.ownerId, env })) return priv("⛔ Les journaux sont réservés au staff.");
  try {
    switch (sub) {
      case "statut": {
        const sources = logSources(env).map((s) => `• ${s.label} (\`${s.slug}\`, ${s.guildId}) : ${s.enabled ? "🟢 actif" : s.slug === "mz" ? "⏸️ réservé (validation requise)" : "⚪ coupé"}`);
        return priv([
          `**Hub** : ${logsHubGuildId(env)}`,
          "**Serveurs sources** :", ...sources,
          `**Alertes** : ${alertRoleId() ? `rôle ${alertRoleId()}` : "aucun rôle de garde"}`,
          `**Conservation** : ${logRetentionDays()} jours • **Résumé** : ${logSummaryFrequency()}`,
          `**En attente** : ${pendingRelayedLogs()}`,
          formatRelayLossLine(),
        ].join("\n"));
      }
      case "rechercher": {
        let since = null;
        if (request.periode) {
          const seconds = parseDurationToSeconds(request.periode);
          if (!seconds) return priv("⚠️ Période illisible : utilise 1h, 7j, 30j…");
          since = now - seconds * 1000;
        }
        const rows = searchLogs({ guildId: guild.id, memberId: request.membreId ?? null, action: request.action ?? null, since, limit: 20 });
        return priv(rows.length ? `**${rows.length} résultat(s)**\n${rows.map(rowLine).join("\n")}` : "ℹ️ Aucun journal ne correspond.");
      }
      case "chronologie": {
        if (!request.membreId) return priv("⚠️ Indique un membre.");
        const rows = memberTimeline(guild.id, request.membreId, 20);
        return priv(rows.length ? `**Chronologie de <@${request.membreId}>**\n${rows.map(rowLine).join("\n")}` : "ℹ️ Aucun journal pour ce membre.");
      }
      case "hub": setLogsHub(String(request.serveur ?? "").trim()); return priv(`✅ Hub des journaux : ${request.serveur}.`);
      case "source-ajouter": addLogSource({ guildId: String(request.serveur ?? "").trim(), slug: request.nom, label: request.libelle }); return priv(`✅ Source ${request.serveur} ajoutée (coupée : active-la avec /logs source-activer).`);
      case "source-activer": setLogSourceEnabled(String(request.serveur ?? "").trim(), request.actif === true); return priv(`✅ Source ${request.serveur} ${request.actif ? "activée" : "coupée"}.`);
      case "source-retirer": removeLogSource(String(request.serveur ?? "").trim()); return priv(`✅ Source ${request.serveur} retirée.`);
      case "alertes": setAlertRoleId(request.role ? String(request.role).replace(/\D/g, "") : null); return priv(request.role ? `✅ Rôle de garde : ${request.role}.` : "✅ Plus de rôle de garde.");
      case "conservation": setLogRetentionDays(request.jours); return priv(`✅ Conservation : ${request.jours} jours.`);
      case "resume": setLogSummaryFrequency(request.frequence); return priv(`✅ Résumé : ${request.frequence}.`);
      default: return priv("⚠️ Sous-commande inconnue. Voir `/logs statut`.");
    }
  } catch (error) {
    return priv(`❌ ${error?.message ?? "Erreur inconnue."}`);
  }
}

export async function handleLogsInteraction(interaction, settings) {
  if (!interaction?.isChatInputCommand?.() || !["logs", "dossier"].includes(interaction.commandName) || !interaction.guild) return false;
  const o = interaction.options;
  const sub = interaction.commandName === "dossier" ? "dossier" : o.getSubcommand();
  const payload = await runLogsCommand({
    guild: interaction.guild, member: interaction.member, userId: interaction.user.id, sub, settings,
    membreId: o.getUser?.("membre", false)?.id ?? null, action: o.getString?.("action", false) ?? null,
    periode: o.getString?.("periode", false) ?? null, serveur: o.getString?.("serveur", false) ?? null,
    nom: o.getString?.("nom", false) ?? null, libelle: o.getString?.("libelle", false) ?? null,
    actif: o.getBoolean?.("actif", false) ?? null, role: o.getString?.("role", false) ?? null,
    jours: o.getInteger?.("jours", false) ?? null, frequence: o.getString?.("frequence", false) ?? null,
    numero: o.getInteger?.("numero", false) ?? null,
  });
  await interaction.reply({ ...payload, ephemeral: true });
  return true;
}

/** =logs <sous-commande> … et =dossier <n>. */
export async function handleLogsMessage(message, settings) {
  const text = String(message?.content ?? "").trim();
  const match = text.match(/^=(logs|dossier)\b\s*(.*)$/i);
  if (!match || !message.guild) return false;
  const words = match[2].split(/\s+/).filter(Boolean);
  const mention = match[2].match(/<@!?(\d{17,20})>/)?.[1] ?? null;
  let request;
  if (match[1].toLowerCase() === "dossier") request = { sub: "dossier", numero: Number(words[0]) };
  else {
    const sub = (words.shift() ?? "statut").toLowerCase();
    const rest = words.filter((w) => !/^<@!?\d+>$/.test(w));
    const period = rest.find((w) => /^\d+(j|d|h|m|min)$/i.test(w)) ?? null;
    request = {
      sub, membreId: mention, periode: period, action: rest.find((w) => /^[a-z_]+$/.test(w) && w !== period) ?? null,
      serveur: rest[0] ?? null, nom: rest[1] ?? null, libelle: rest.slice(2).join(" ") || null,
      actif: /^(oui|on|true|1)$/i.test(rest[1] ?? ""), role: rest[0] ?? null, jours: Number(rest[0]), frequence: rest[0] ?? null,
    };
  }
  const payload = await runLogsCommand({ ...request, guild: message.guild, member: message.member, userId: message.author.id, settings });
  // Écran staff : en préfixe, le détail part en message privé, le salon ne voit qu'un accusé.
  const { visibility, ...data } = payload;
  void visibility;
  const sent = await message.author.send(data).then(() => true).catch(() => false);
  await message.reply({ content: sent ? "📬 Réponse envoyée en message privé." : "❌ Impossible de t'envoyer un message privé (MP fermés).", allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
