import { logChannelKey } from "./logs-hub.js";

/**
 * Logs Hub coverage matrix: every event the bot is expected to journal,
 * where it must land, and what Discord needs for it to be delivered.
 * logs-coverage.test.js checks the routing of every sample title and that
 * index.js really listens to each gateway event with the required intent.
 *
 * status: "covered" (journalisé), "partial" (journalisé sans détail
 * complet), "not_covered" (volontairement absent, raison donnée).
 */
export const LOG_EVENT_MATRIX = Object.freeze([
  // Gateway — membres
  {
    event: "guildMemberAdd",
    source: "gateway",
    intent: "GuildMembers",
    title: "👋 Arrivée d’un membre",
    key: "members",
    status: "covered",
  },
  {
    event: "guildMemberRemove",
    source: "gateway",
    intent: "GuildMembers",
    title: "🚪 Départ d’un membre",
    key: "members",
    status: "covered",
  },
  {
    event: "guildMemberUpdate",
    source: "gateway",
    intent: "GuildMembers",
    title: "🎭 Modification des rôles",
    key: "members",
    status: "covered",
  },
  {
    event: "guildMemberUpdate",
    source: "gateway",
    intent: "GuildMembers",
    title: "✏️ Pseudonyme modifié",
    key: "members",
    status: "covered",
  },
  {
    event: "guildMemberUpdate",
    source: "gateway",
    intent: "GuildMembers",
    title: "⏳ Exclusion temporaire appliquée",
    key: "moderation",
    status: "covered",
  },
  // Gateway — modération
  {
    event: "guildBanAdd",
    source: "gateway",
    intent: "GuildModeration",
    title: "⛔ Membre banni",
    key: "moderation",
    status: "covered",
  },
  {
    event: "guildBanRemove",
    source: "gateway",
    intent: "GuildModeration",
    title: "✅ Bannissement retiré",
    key: "moderation",
    status: "covered",
  },
  // Gateway — messages (aucun contenu enregistré)
  {
    event: "messageDelete",
    source: "gateway",
    intent: "GuildMessages",
    title: "🗑️ Message supprimé",
    key: "members",
    status: "partial",
    note: "Contenu volontairement non enregistré.",
  },
  {
    event: "messageDeleteBulk",
    source: "gateway",
    intent: "GuildMessages",
    title: "🧹 Suppression groupée de messages",
    key: "moderation",
    status: "covered",
  },
  {
    event: "messageUpdate",
    source: "gateway",
    intent: "GuildMessages",
    title: "✏️ Message modifié",
    key: "members",
    status: "partial",
    note: "Lien et auteur seulement, jamais le contenu.",
  },
  // Gateway — structure
  {
    event: "channelCreate",
    source: "gateway",
    intent: "Guilds",
    title: "➕ Salon créé",
    key: "staff",
    status: "covered",
  },
  {
    event: "channelDelete",
    source: "gateway",
    intent: "Guilds",
    title: "➖ Salon supprimé",
    key: "staff",
    status: "covered",
  },
  {
    event: "channelUpdate",
    source: "gateway",
    intent: "Guilds",
    title: "✏️ Salon renommé",
    key: "staff",
    status: "covered",
  },
  {
    event: "channelUpdate",
    source: "gateway",
    intent: "Guilds",
    title: "🔐 Permissions d’un salon modifiées",
    key: "permissions",
    status: "covered",
  },
  {
    event: "roleCreate",
    source: "gateway",
    intent: "Guilds",
    title: "🎭 Rôle créé",
    key: "permissions",
    status: "covered",
  },
  {
    event: "roleDelete",
    source: "gateway",
    intent: "Guilds",
    title: "🎭 Rôle supprimé",
    key: "permissions",
    status: "covered",
  },
  {
    event: "roleUpdate",
    source: "gateway",
    intent: "Guilds",
    title: "✏️ Rôle modifié",
    key: "permissions",
    status: "covered",
  },
  {
    event: "guildUpdate",
    source: "gateway",
    intent: "Guilds",
    title: "⚙️ Serveur modifié",
    key: "staff",
    status: "covered",
  },
  {
    event: "threadCreate",
    source: "gateway",
    intent: "Guilds",
    title: "🧵 Fil créé",
    key: "staff",
    status: "covered",
  },
  {
    event: "threadDelete",
    source: "gateway",
    intent: "Guilds",
    title: "🧵 Fil supprimé",
    key: "staff",
    status: "covered",
  },
  {
    event: "inviteCreate",
    source: "gateway",
    intent: "GuildInvites",
    title: "🔗 Invitation créée",
    key: "security",
    status: "covered",
  },
  {
    event: "inviteDelete",
    source: "gateway",
    intent: "GuildInvites",
    title: "🗑️ Invitation supprimée",
    key: "security",
    status: "covered",
  },
  // Sécurité (dérivé)
  {
    event: "roleUpdate",
    source: "derived",
    title: "🚨 Permission dangereuse accordée",
    key: "security",
    status: "covered",
  },
  {
    event: "channelUpdate",
    source: "derived",
    title: "🚨 ACL risquée sur un salon",
    key: "security",
    status: "covered",
  },
  // Bot — vocal
  {
    event: "anti_move",
    source: "bot",
    title: "🛡️ ANTI-MOVE — déplacement bloqué",
    key: "voice",
    status: "covered",
  },
  {
    event: "anti_move",
    source: "bot",
    title: "🛡️ ANTI-MOVE — déconnexion forcée",
    key: "voice",
    status: "covered",
  },
  {
    event: "wakeup",
    source: "bot",
    title: "⏰ WAKEUP — séquence terminée",
    key: "voice",
    status: "covered",
  },
  {
    event: "dog",
    source: "bot",
    title: "🐶 DOG — laisse attribuée",
    key: "dog",
    status: "covered",
  },
  {
    event: "menotte",
    source: "bot",
    title: "🔒 MENOTTE — membre immobilisé",
    key: "dog",
    status: "covered",
  },
  {
    event: "temp_voice",
    source: "bot",
    title: "🎙️ Join-to-Create — Salon vocal temporaire créé",
    key: "voice",
    status: "covered",
  },
  // Bot — administration
  {
    event: "rankall",
    source: "bot",
    title: "🎭 Attribution générale de rôle",
    key: "permissions",
    status: "covered",
  },
  {
    event: "rankall",
    source: "bot",
    title: "↩️ Attribution générale annulée",
    key: "permissions",
    status: "covered",
  },
  {
    event: "role_manager",
    source: "bot",
    title: "🎭 Rôle attribué",
    key: "members",
    status: "covered",
  },
  {
    event: "guardian",
    source: "bot",
    title: "🛡️ Guardian — dossier à examiner",
    key: "security",
    status: "covered",
  },
  {
    event: "health",
    source: "bot",
    title: "🩺 Santé du bot — alerte",
    key: "system",
    status: "covered",
  },
  // Bot — économie, IA, webhooks, live
  {
    event: "casino",
    source: "bot",
    title: "🎰 PND Casino — Slots",
    key: "casino",
    status: "covered",
  },
  {
    event: "ai",
    source: "bot",
    title: "🤖 IA — demande traitée",
    key: "ai",
    status: "covered",
  },
  {
    event: "webhooks",
    source: "bot",
    title: "📢 Publication Webhook",
    key: "webhooks",
    status: "covered",
  },
  {
    event: "live_alerts",
    source: "bot",
    title: "🔴 Alerte LIVE publiée",
    key: "system",
    status: "covered",
  },
  // Volontairement non couverts
  {
    event: "voiceStateUpdate",
    source: "gateway",
    intent: "GuildVoiceStates",
    title: null,
    key: null,
    status: "not_covered",
    note: "Présence vocale tracée en base (voice-audit), pas dans le hub : trop volumineux.",
  },
  {
    event: "messageCreate",
    source: "gateway",
    intent: "MessageContent",
    title: null,
    key: null,
    status: "not_covered",
    note: "Aucune copie de messages : confidentialité.",
  },
  {
    event: "emojiCreate",
    source: "gateway",
    intent: "GuildExpressions",
    title: null,
    key: null,
    status: "not_covered",
    note: "Intent non demandé.",
  },
  {
    event: "autoModerationActionExecution",
    source: "gateway",
    intent: "AutoModerationExecution",
    title: null,
    key: null,
    status: "not_covered",
    note: "Intent non demandé ; AutoMod Discord journalise déjà.",
  },
]);

export function verifyMatrixRouting(matrix = LOG_EVENT_MATRIX) {
  return matrix
    .filter((row) => row.title && logChannelKey(row.title) !== row.key)
    .map((row) => ({
      title: row.title,
      expected: row.key,
      actual: logChannelKey(row.title),
    }));
}

/** Gateway rows with status covered/partial whose listener or intent is missing in the source. */
export function verifyGatewayWiring(indexSource, matrix = LOG_EVENT_MATRIX) {
  const problems = [];
  for (const row of matrix) {
    if (row.source !== "gateway" || row.status === "not_covered") continue;
    if (!indexSource.includes(`client.on("${row.event}"`))
      problems.push({ event: row.event, problem: "listener" });
    if (row.intent && !indexSource.includes(`GatewayIntentBits.${row.intent}`))
      problems.push({ event: row.event, problem: `intent ${row.intent}` });
  }
  return problems;
}

export function formatCoverageSummary(matrix = LOG_EVENT_MATRIX) {
  const count = (status) =>
    matrix.filter((row) => row.status === status).length;
  const gaps = matrix
    .filter((row) => row.status !== "covered")
    .map(
      (row) =>
        `• \`${row.event}\` — ${row.status === "partial" ? "partiel" : "non couvert"} : ${row.note ?? ""}`,
    );
  return [
    `**Couverture Logs Hub** — couverts ${count("covered")} · partiels ${count("partial")} · non couverts ${count("not_covered")}`,
    ...gaps,
  ].join("\n");
}
