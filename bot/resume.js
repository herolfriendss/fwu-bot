// FWU RESUME: an absent administrator finds the important events that happened
// while they were away. /afk on · /afk off · /afk resume (and =afk …).
//
// Events come from the central log pipeline (sendCentralLog), so every log of
// every FWU bot is seen exactly once, by FWU. Only short, already-sanitised log
// text is kept (logs never contain message content), for 14 days.
import { db } from "./database.js";
import { logChannelKey } from "./logs-hub.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { isAdminPlus, isSysPlus } from "./systems/sysplus/permissions.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";

export const RESUME_RETENTION_MS = 14 * 24 * 60 * 60_000;
const MAX_IMPORTANT_LINES = 15;
const MAX_HOURS = 168;

db.exec(`
  CREATE TABLE IF NOT EXISTS resume_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('high','medium','info')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS resume_events_guild_at_idx ON resume_events(guild_id, at);
  CREATE TABLE IF NOT EXISTS afk_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    reason TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS afk_sessions_active_idx ON afk_sessions(guild_id, user_id) WHERE ended_at IS NULL;
  CREATE INDEX IF NOT EXISTS afk_sessions_member_idx ON afk_sessions(guild_id, user_id, started_at DESC);
`);

export const CATEGORY_LABELS = Object.freeze({
  security: "🛡️ Sécurité",
  moderation: "⛔ Sanctions",
  permissions: "🔐 Permissions",
  members: "👥 Membres",
  voice: "🎙️ Vocal",
  dog: "🐕 DOG / MENOTTE",
  tickets: "🎫 Tickets",
  recruitment: "📝 Candidatures",
  economy: "💰 Économie",
  casino: "🎰 Casino",
  games: "🎲 Jeux",
  automation: "⚙️ Automatisations",
  webhooks: "🔗 Webhooks",
  verification: "✅ Vérification",
  supervisors: "🧭 Staff",
  staff: "🧭 Staff",
  system: "🖥️ Système",
  errors: "⚠️ Erreurs",
  ai: "🤖 IA",
});

const HIGH_COLORS = new Set([0xdc2626, 0xef4444]);
const MEDIUM_COLORS = new Set([0xf59e0b]);
// Routine usage logs ("commande utilisée", "action effectuée") are not events
// an absent admin needs: they would drown the summary.
const ROUTINE = /commande utilisée|action effectuée/i;

export function severityOf(embed) {
  const title = String(embed?.title ?? "");
  if (/🚨|⛔|alerte|critique|raid/i.test(title) || HIGH_COLORS.has(Number(embed?.color))) return "high";
  if (/⚠️|⏳|🛡️/.test(title) || MEDIUM_COLORS.has(Number(embed?.color))) return "medium";
  return "info";
}

function firstUsefulLine(description) {
  const lines = String(description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Serveur source\s*:/i.test(line));
  return (lines[0] ?? "").slice(0, 160);
}

/** Keep one log line for RESUME. Returns false when the log is routine noise. */
export function recordResumeEvent(guildId, embed, now = Date.now()) {
  const title = String(embed?.title ?? "").trim().slice(0, 120);
  if (!guildId || !title || ROUTINE.test(title)) return false;
  const info = db.prepare("INSERT INTO resume_events(guild_id, at, category, severity, title, summary) VALUES (?, ?, ?, ?, ?, ?)")
    .run(String(guildId), now, logChannelKey(title), severityOf(embed), title, firstUsefulLine(embed?.description));
  if (Number(info.lastInsertRowid) % 200 === 0) pruneResumeEvents(now);
  return true;
}

export function pruneResumeEvents(now = Date.now()) {
  return Number(db.prepare("DELETE FROM resume_events WHERE at < ?").run(now - RESUME_RETENTION_MS).changes ?? 0);
}

export function activeAfkSession(guildId, userId) {
  return db.prepare("SELECT id, started_at, reason FROM afk_sessions WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL")
    .get(guildId, userId) ?? null;
}

export function startAfk(guildId, userId, reason = "", now = Date.now()) {
  const current = activeAfkSession(guildId, userId);
  if (current) return { started: false, session: current };
  db.prepare("INSERT INTO afk_sessions(guild_id, user_id, started_at, reason) VALUES (?, ?, ?, ?)")
    .run(guildId, userId, now, String(reason ?? "").trim().slice(0, 200));
  return { started: true, session: activeAfkSession(guildId, userId) };
}

export function endAfk(guildId, userId, now = Date.now()) {
  const current = activeAfkSession(guildId, userId);
  if (!current) return null;
  db.prepare("UPDATE afk_sessions SET ended_at = ? WHERE id = ?").run(now, current.id);
  return { ...current, ended_at: now };
}

/** Summary data for a period: counts per category and the important lines. */
export function summarizeResume(guildId, since, until = Date.now()) {
  const counts = db.prepare(`
    SELECT category, COUNT(*) AS total, SUM(severity = 'high') AS high
    FROM resume_events WHERE guild_id = ? AND at >= ? AND at <= ?
    GROUP BY category ORDER BY high DESC, total DESC
  `).all(guildId, since, until).map((row) => ({ category: row.category, total: Number(row.total), high: Number(row.high ?? 0) }));
  const important = db.prepare(`
    SELECT at, severity, title, summary FROM resume_events
    WHERE guild_id = ? AND at >= ? AND at <= ? AND severity IN ('high','medium')
    ORDER BY (severity = 'high') DESC, at DESC LIMIT ?
  `).all(guildId, since, until, MAX_IMPORTANT_LINES);
  const total = counts.reduce((sum, row) => sum + row.total, 0);
  return { since, until, total, counts, important };
}

export function buildResumeEmbed(summary, { reason = "", ended = false } = {}) {
  const from = Math.floor(summary.since / 1000);
  const to = Math.floor(summary.until / 1000);
  const lines = [`Période : <t:${from}:f> → <t:${to}:f> (<t:${from}:R>)`];
  if (reason) lines.push(`Raison de l'absence : ${reason}`);
  if (!summary.total) {
    lines.push("", "✅ Rien d'important ne s'est passé pendant ton absence.");
  } else {
    lines.push("", `**${summary.total}** événement(s) enregistré(s).`);
  }
  const fields = [];
  if (summary.counts.length) {
    fields.push({
      name: "Par domaine",
      value: summary.counts.slice(0, 12).map((row) => `${CATEGORY_LABELS[row.category] ?? row.category} : **${row.total}**${row.high ? ` (dont ${row.high} 🚨)` : ""}`).join("\n").slice(0, 1024),
    });
  }
  if (summary.important.length) {
    fields.push({
      name: "À regarder en priorité",
      value: summary.important
        .map((row) => `${row.severity === "high" ? "🚨" : "⚠️"} <t:${Math.floor(row.at / 1000)}:R> **${row.title}**${row.summary ? ` — ${row.summary}` : ""}`)
        .join("\n")
        .slice(0, 1024),
    });
  }
  return {
    title: ended ? "📋 RESUME — bon retour" : "📋 RESUME — pendant ton absence",
    description: lines.join("\n"),
    color: summary.important.some((row) => row.severity === "high") ? 0xdc2626 : 0xe21d2f,
    fields,
    footer: { text: "RESUME · détails complets dans le Logs Hub" },
  };
}

/** RESUME is for the staff: the OWNER, SYS+ and ADMIN+. */
export function canUseResume(member, guildSettings) {
  if (!member?.guild || !member.id) return false;
  if (parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) === member.id) return true;
  const sysPlusRoleId = guildSettings?.sysPlus?.roleId ?? null;
  if (isSysPlus(member, sysPlusRoleId)) return true;
  let adminPlusRoleId = null;
  try { adminPlusRoleId = getAdminPlusRoleId(member.guild.id); } catch { adminPlusRoleId = null; }
  return isAdminPlus(member, sysPlusRoleId, adminPlusRoleId);
}

const DENIED = "🔒 RESUME est réservé à l'OWNER, aux SYS+ et aux ADMIN+.";

/** Shared logic for slash and prefix. Returns { content?, embed?, private } */
export function runAfkAction({ guildId, userId, action, reason = "", hours = null, now = Date.now() }) {
  if (action === "on") {
    const result = startAfk(guildId, userId, reason, now);
    if (!result.started) {
      return { content: `🌙 Tu es déjà absent depuis <t:${Math.floor(result.session.started_at / 1000)}:R>. Utilise \`/afk resume\` pour voir ce que tu as manqué, ou \`/afk off\` à ton retour.` };
    }
    return { content: `🌙 Absence démarrée. Les événements importants sont gardés pour toi : \`/afk off\` à ton retour pour le résumé.${result.session.reason ? `\nRaison : ${result.session.reason}` : ""}`, announce: true };
  }
  if (action === "off") {
    const ended = endAfk(guildId, userId, now);
    if (!ended) return { content: "Tu n'étais pas en absence. `/afk resume heures:24` affiche les dernières 24 h." };
    return { embed: buildResumeEmbed(summarizeResume(guildId, ended.started_at, now), { reason: ended.reason, ended: true }), private: true };
  }
  if (action === "resume") {
    const current = activeAfkSession(guildId, userId);
    const span = Math.min(MAX_HOURS, Math.max(1, Number.isFinite(Number(hours)) && Number(hours) > 0 ? Math.floor(Number(hours)) : 24));
    const since = current && !hours ? current.started_at : now - span * 60 * 60_000;
    return { embed: buildResumeEmbed(summarizeResume(guildId, since, now), { reason: current && !hours ? current.reason : "" }), private: true };
  }
  return { content: "Utilise `/afk on [raison]`, `/afk off` ou `/afk resume [heures]`." };
}

export async function handleResumeInteraction(interaction, guildSettings) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "afk") return false;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  if (!canUseResume(interaction.member, guildSettings)) {
    await interaction.reply({ content: DENIED, ephemeral: true });
    return true;
  }
  const action = interaction.options.getSubcommand(false) ?? "resume";
  const result = runAfkAction({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    action,
    reason: interaction.options.getString?.("raison") ?? "",
    hours: interaction.options.getInteger?.("heures") ?? null,
  });
  await interaction.reply({
    ...(result.content ? { content: result.content } : {}),
    ...(result.embed ? { embeds: [result.embed] } : {}),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  return true;
}

export function parseAfkPrefix(content) {
  const match = /^=afk(?:\s+(on|off|resume|recap|résumé|resumé))?(?:\s+([\s\S]*))?$/i.exec(String(content ?? "").trim());
  if (!match) return null;
  const word = (match[1] ?? "").toLowerCase();
  const action = word === "on" || word === "off" ? word : word ? "resume" : "status";
  const rest = String(match[2] ?? "").trim();
  return { action, reason: action === "on" ? rest.slice(0, 200) : "", hours: action === "resume" && /^\d{1,3}$/.test(rest) ? Number(rest) : null };
}

export async function handleResumeMessage(message, guildSettings) {
  if (!message?.guild || !message.member || message.author?.bot) return false;
  const parsed = parseAfkPrefix(message.content);
  if (!parsed) return false;
  const mentions = { parse: [], repliedUser: false };
  if (!canUseResume(message.member, guildSettings)) {
    await message.reply({ content: DENIED, allowedMentions: mentions });
    return true;
  }
  if (parsed.action === "status") {
    const current = activeAfkSession(message.guild.id, message.author.id);
    await message.reply({
      content: current
        ? `🌙 Absent depuis <t:${Math.floor(current.started_at / 1000)}:R>. \`=afk resume\` (résumé en MP) · \`=afk off\` à ton retour.`
        : "Tu n'es pas en absence. `=afk on [raison]` · `=afk resume [heures]` (résumé en MP).",
      allowedMentions: mentions,
    });
    return true;
  }
  const result = runAfkAction({ guildId: message.guild.id, userId: message.author.id, action: parsed.action, reason: parsed.reason, hours: parsed.hours });
  if (!result.embed) {
    await message.reply({ content: result.content, allowedMentions: mentions });
    return true;
  }
  // The summary lists security events: never in a public channel. One DM, one ✅.
  const sent = await message.author.send({ embeds: [result.embed], allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
  if (sent) {
    await message.react?.("📬").catch(() => {});
    if (parsed.action === "off") await message.reply({ content: "✅ Absence terminée. Ton résumé t'attend en MP.", allowedMentions: mentions });
  } else {
    await message.reply({ content: `⚠️ Je ne peux pas t'envoyer de MP. Ouvre tes MP ou utilise \`/afk ${parsed.action === "off" ? "resume heures:24" : "resume"}\` (réponse visible par toi seul).`, allowedMentions: mentions });
  }
  return true;
}
