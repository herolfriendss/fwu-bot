// GUARD — signaler un message (clic droit → Applications → « Signaler au staff »).
//   Le membre peut ajouter une raison ; le staff reçoit le signalement dans les logs de modération
//   avec trois boutons : Supprimer le message, Mute 10 min (quota tempmute du palier), Ignorer.
//   Garde-fous : un signalement par membre et par message, 5 par membre toutes les 10 minutes,
//   pas de signalement d'un bot ni de soi-même. Désactivable avec PND_REPORTS=off.
import { ActionRowBuilder, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle } from "discord.js";
import { db } from "../database.js";
import { checkTargetHierarchy } from "../hierarchy-guard.js";
import { openModerationGate } from "../shared/moderation-gate.js";

export const REPORT_MENU_NAME = "Signaler au staff";
export const REPORT = Object.freeze({ perUserLimit: 5, windowMs: 10 * 60_000, muteMs: 10 * 60_000, excerpt: 900 });
/** Commande de menu contextuel (type 3 = message), enregistrée par GUARD. */
export const REPORT_CONTEXT_COMMAND = Object.freeze({ name: REPORT_MENU_NAME, type: 3, dm_permission: false });

db.exec(`CREATE TABLE IF NOT EXISTS guard_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
  author_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT, excerpt TEXT, status TEXT NOT NULL DEFAULT 'open',
  handled_by TEXT, created_at INTEGER NOT NULL, handled_at INTEGER, UNIQUE (message_id, reporter_id)
)`);

/** Pur : rend la raison du refus, ou null si le signalement est accepté. */
export function reportRefusal({ guildId, messageId, authorId, authorIsBot, reporterId }, now = Date.now()) {
  if (authorIsBot) return "On ne signale pas un message de bot.";
  if (authorId === reporterId) return "Tu ne peux pas signaler ton propre message.";
  if (db.prepare("SELECT 1 FROM guard_reports WHERE message_id=? AND reporter_id=?").get(messageId, reporterId)) return "Tu as déjà signalé ce message.";
  const recent = Number(db.prepare("SELECT COUNT(*) AS n FROM guard_reports WHERE guild_id=? AND reporter_id=? AND created_at>?").get(guildId, reporterId, now - REPORT.windowMs)?.n ?? 0);
  if (recent >= REPORT.perUserLimit) return "Trop de signalements en peu de temps : réessaie dans quelques minutes.";
  return null;
}

export function createReport({ guildId, channelId, messageId, authorId, reporterId, reason = null, excerpt = "" }, now = Date.now()) {
  const info = db.prepare("INSERT INTO guard_reports(guild_id,channel_id,message_id,author_id,reporter_id,reason,excerpt,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(guildId, channelId, messageId, authorId, reporterId, reason ? String(reason).slice(0, 500) : null, String(excerpt).slice(0, REPORT.excerpt), now);
  return Number(info.lastInsertRowid);
}

export function getReport(id) {
  return db.prepare("SELECT * FROM guard_reports WHERE id=?").get(Number(id)) ?? null;
}

/** Ferme le signalement (et les autres signalements ouverts du même message). Rend false s'il était déjà traité. */
export function closeReport(id, status, handledBy, now = Date.now()) {
  const report = getReport(id);
  if (!report || report.status !== "open") return false;
  db.prepare("UPDATE guard_reports SET status=?, handled_by=?, handled_at=? WHERE message_id=? AND status='open'").run(status, handledBy, now, report.message_id);
  return true;
}

export const reportButtons = (guildId, id) => [{
  type: 1,
  components: [
    { type: 2, style: 4, label: "Supprimer le message", emoji: { name: "🗑️" }, custom_id: `report:delete:${guildId}:${id}` },
    { type: 2, style: 1, label: "Mute 10 min", emoji: { name: "🔇" }, custom_id: `report:mute:${guildId}:${id}` },
    { type: 2, style: 2, label: "Ignorer", emoji: { name: "✖️" }, custom_id: `report:ignore:${guildId}:${id}` },
  ],
}];

const DONE_LABELS = { deleted: "🗑️ Message supprimé", muted: "🔇 Auteur mute 10 min", ignored: "✖️ Ignoré" };
const doneRow = (status, who) => [{ type: 1, components: [{ type: 2, style: 2, disabled: true, custom_id: "report:done", label: `${DONE_LABELS[status]} par ${who}`.slice(0, 80) }] }];

const isStaff = (member) => Boolean(member?.permissions?.has?.(P.ManageMessages) || member?.permissions?.has?.(P.ModerateMembers) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

/**
 * Menu contextuel, formulaire de raison, boutons du staff. `logReport(guild, report)` envoie au staff
 * (injecté depuis index.js : logs de modération avec les boutons).
 */
export async function handleReportInteraction(interaction, { client, logReport, env = process.env, now = Date.now() } = {}) {
  if (interaction?.isMessageContextMenuCommand?.() && interaction.commandName === REPORT_MENU_NAME) {
    if (String(env.PND_REPORTS ?? "").toLowerCase() === "off" || !interaction.guild) {
      await interaction.reply({ content: "Les signalements sont désactivés ici.", ephemeral: true }).catch(() => {});
      return true;
    }
    const target = interaction.targetMessage;
    const refusal = reportRefusal({ guildId: interaction.guild.id, messageId: target.id, authorId: target.author?.id, authorIsBot: target.author?.bot, reporterId: interaction.user.id }, now);
    if (refusal) { await interaction.reply({ content: `⛔ ${refusal}`, ephemeral: true }).catch(() => {}); return true; }
    const reason = new TextInputBuilder().setCustomId("reason").setLabel("Pourquoi ? (facultatif)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
    await interaction.showModal(new ModalBuilder().setCustomId(`report:modal:${target.channelId}:${target.id}`).setTitle("Signaler au staff").addComponents(new ActionRowBuilder().addComponents(reason))).catch(() => {});
    return true;
  }
  const id = String(interaction?.customId ?? "");
  if (interaction?.isModalSubmit?.() && id.startsWith("report:modal:")) {
    const [, , channelId, messageId] = id.split(":");
    const channel = interaction.guild?.channels?.cache?.get(channelId);
    const message = await channel?.messages?.fetch?.(messageId).catch(() => null);
    if (!message) { await interaction.reply({ content: "⚠️ Ce message n'existe plus.", ephemeral: true }).catch(() => {}); return true; }
    const refusal = reportRefusal({ guildId: interaction.guild.id, messageId, authorId: message.author?.id, authorIsBot: message.author?.bot, reporterId: interaction.user.id }, now);
    if (refusal) { await interaction.reply({ content: `⛔ ${refusal}`, ephemeral: true }).catch(() => {}); return true; }
    const reason = interaction.fields.getTextInputValue("reason")?.trim() || null;
    const excerpt = String(message.content ?? "").trim() || (message.attachments?.size ? "(pièce jointe)" : "(message vide)");
    const reportId = createReport({ guildId: interaction.guild.id, channelId, messageId, authorId: message.author.id, reporterId: interaction.user.id, reason, excerpt }, now);
    await logReport?.(interaction.guild, { ...getReport(reportId), url: message.url });
    await interaction.reply({ content: "✅ Merci, le staff a reçu ton signalement. Il reste anonyme pour l'auteur du message.", ephemeral: true }).catch(() => {});
    return true;
  }
  if (!interaction?.isButton?.() || !/^report:(delete|mute|ignore):/.test(id)) return false;
  const [, action, guildId, reportId] = id.split(":");
  const guild = client?.guilds?.cache?.get?.(guildId);
  const report = getReport(reportId);
  if (!guild || !report) { await interaction.reply({ content: "⚠️ Signalement introuvable.", ephemeral: true }).catch(() => {}); return true; }
  const staff = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!isStaff(staff)) { await interaction.reply({ content: "⛔ Réservé au staff du serveur (Gérer les messages ou Modérer les membres).", ephemeral: true }).catch(() => {}); return true; }
  if (report.status !== "open") { await interaction.reply({ content: "Ce signalement a déjà été traité.", ephemeral: true }).catch(() => {}); return true; }
  let status = "ignored";
  if (action === "delete") {
    const message = await guild.channels.cache.get(report.channel_id)?.messages?.fetch?.(report.message_id).catch(() => null);
    if (message) await message.delete().catch(() => null);
    status = "deleted";
  } else if (action === "mute") {
    const target = await guild.members.fetch(report.author_id).catch(() => null);
    if (!target) { await interaction.reply({ content: "⚠️ L'auteur n'est plus sur le serveur.", ephemeral: true }).catch(() => {}); return true; }
    const above = await checkTargetHierarchy(guild, staff.id, target.id).catch(() => "⛔ Hiérarchie des rôles illisible : action refusée par sécurité.");
    if (above) { await interaction.reply({ content: above, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {}); return true; }
    const gate = await openModerationGate({ member: staff, command: "tempmute", bot: "guard", targetId: target.id, env });
    if (!gate.ok) { await interaction.reply({ content: gate.message, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {}); return true; }
    try {
      await target.timeout(REPORT.muteMs, `Signalement #${report.id} (par ${staff.user?.username ?? staff.id})`);
      await gate.succeed(`signalement #${report.id}`);
    } catch (error) {
      await gate.fail(error);
      await interaction.reply({ content: "❌ Mute impossible (hiérarchie ou permission Modérer les membres).", ephemeral: true }).catch(() => {});
      return true;
    }
    status = "muted";
  }
  closeReport(report.id, status, staff.id, now);
  await interaction.update({ components: doneRow(status, staff.displayName ?? staff.user?.username ?? "le staff") }).catch(() => {});
  return true;
}
