// /sysp fiche @membre (idée SYS+ n°7) : tout ce que les 5 bots savent d'un membre, en une vue.
// Lecture seule. Réservé aux SYS+ et à l'owner. Chaque consultation est notée dans l'audit SYS+.
import { EmbedBuilder } from "discord.js";
import { db, tableExists } from "../../database.js";
import { memberOverview } from "../../features/overview.js";
import { formatHistoryEntry, HISTORY_LABELS, loadMemberHistory, summarizeHistory } from "../../member-history.js";
import { getMemberInvite } from "../../invite-attribution.js";
import { listSysPlusAudit, recordSysPlusAudit } from "./audit.js";

const ts = (ms, style = "R") => (ms ? `<t:${Math.floor(Number(ms) / 1000)}:${style}>` : "inconnu");
const pnd = (value) => `${Number(value ?? 0).toLocaleString("fr-FR")} PND`;

function ticketStats(guildId, userId) {
  if (!tableExists("tickets")) return null;
  const row = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM tickets WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return { total: Number(row?.total ?? 0), open: Number(row?.open ?? 0) };
}

function quarantineOf(guildId, userId) {
  if (!tableExists("guard_quarantine")) return null;
  return db.prepare("SELECT reason, moderator_id, created_at FROM guard_quarantine WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? null;
}

function inviteLine(invite) {
  if (!invite) return "Arrivée non enregistrée (avant la fiche, ou autre bot).";
  if (invite.source === "invite") return `Invitation \`${invite.code}\`${invite.inviterId ? ` de <@${invite.inviterId}>` : ""}`;
  if (invite.source === "vanity") return "URL personnalisée du serveur";
  return "Invitation inconnue";
}

/** Données de la fiche (séparées de l'affichage pour les tests). */
export async function collectMemberCard({ guildId, userId, member = null, now = Date.now(), loadCentral }) {
  const history = await loadMemberHistory({ guildId, userId, limit: 100, ...(loadCentral ? { loadCentral } : {}) });
  return {
    overview: memberOverview(guildId, userId, { member, now }),
    history,
    counts: summarizeHistory(history.entries),
    invite: getMemberInvite(guildId, userId),
    tickets: ticketStats(guildId, userId),
    quarantine: quarantineOf(guildId, userId),
    audit: listSysPlusAudit(guildId, 3, { memberId: userId }),
  };
}

export function memberCardEmbed(card, { user, member = null }) {
  const { overview, history, counts, invite, tickets, quarantine, audit } = card;
  const embed = new EmbedBuilder().setColor(0x6d28d9)
    .setTitle(`🗂️ Fiche de ${user.tag ?? user.username ?? user.id}`.slice(0, 250))
    .setFooter({ text: "SYS+ · lecture seule · cette consultation est notée dans l'audit SYS+" });
  const avatar = typeof user.displayAvatarURL === "function" ? user.displayAvatarURL() : null;
  if (avatar) embed.setThumbnail(avatar);

  const roles = member?.roles?.cache
    ? [...member.roles.cache.values()].filter((r) => r.id !== member.guild?.id).sort((a, b) => b.position - a.position)
    : [];
  embed.addFields({
    name: "👤 Identité",
    value: [
      `<@${user.id}> · \`${user.id}\``,
      `Compte créé ${ts(user.createdTimestamp)}`,
      member ? `Arrivé ${ts(member.joinedTimestamp)} · ${inviteLine(invite)}` : "**N'est plus sur le serveur.**",
      roles.length ? `Rôles (${roles.length}) : ${roles.slice(0, 12).map((r) => `<@&${r.id}>`).join(" ")}${roles.length > 12 ? " …" : ""}` : null,
    ].filter(Boolean).join("\n").slice(0, 1024),
  });

  const live = [
    `${overview.trust.tier.emoji} Confiance **${overview.trust.score}/100** · ${overview.trust.tier.label}`,
    `Avertissements actifs : **${overview.record.warnings}**`,
    ...overview.sanctions.map((s) => `⛔ Restriction \`${s.scope}\` jusqu'à ${ts(s.until, "f")}${s.reason ? ` · ${String(s.reason).slice(0, 80)}` : ""}`),
    quarantine ? `🔒 En quarantaine depuis ${ts(quarantine.created_at)} (par <@${quarantine.moderator_id}>) · ${String(quarantine.reason).slice(0, 80)}` : null,
  ].filter(Boolean);
  embed.addFields({ name: "🛡️ État actuel", value: live.join("\n").slice(0, 1024) });

  const summary = Object.entries(counts).map(([action, n]) => `${HISTORY_LABELS[action] ?? action} ×${n}`).join(" · ") || "aucune";
  const recent = history.entries.slice(0, 5).map(formatHistoryEntry);
  embed.addFields({
    name: `📁 Sanctions (${history.entries.filter((e) => !e.removed).length}, tous bots)`,
    value: [`Bilan : ${summary}`, ...recent, history.centralAvailable ? null : "⚠️ Base centrale injoignable : casier de ce bot seulement."]
      .filter(Boolean).join("\n").slice(0, 1024),
  });

  const activity = [];
  if (overview.level) activity.push(`⭐ Niveau **${overview.level.level}** (${overview.level.rank}ᵉ/${overview.level.total}) · ${overview.level.messages.toLocaleString("fr-FR")} messages`);
  if (overview.economy) activity.push(`💰 ${pnd(overview.economy.balance)} en poche · ${pnd(overview.economy.bank)} en banque`);
  if (tickets) activity.push(`🎫 Tickets : ${tickets.total} (${tickets.open} ouvert${tickets.open > 1 ? "s" : ""})`);
  if (activity.length) embed.addFields({ name: "📊 Activité", value: activity.join("\n").slice(0, 1024) });

  if (audit.length) {
    embed.addFields({
      name: "🧾 Dernières actions SYS+ le concernant",
      value: audit.map((row) => `• ${ts(row.createdAt)} \`${row.action}\` par <@${row.actorId}>`).join("\n").slice(0, 1024),
    });
  }
  return embed;
}

export async function handleMemberCardCommand(interaction, { member, roleId, isSysPlus, isOwner }) {
  if (!isOwner && !isSysPlus(member, roleId)) {
    await interaction.reply({ content: "⛔ Réservé aux SYS+ et à l'owner.", ephemeral: true });
    return true;
  }
  const user = interaction.options.getUser("membre", true);
  await interaction.deferReply({ ephemeral: true });
  const target = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  const card = await collectMemberCard({ guildId: interaction.guildId, userId: user.id, member: target });
  try { recordSysPlusAudit(interaction.guildId, interaction.user.id, "fiche.consultation", user.id); } catch { /* l'affichage passe quand même */ }
  await interaction.editReply({ embeds: [memberCardEmbed(card, { user, member: target })], allowedMentions: { parse: [] } });
  return true;
}
