// /sysp suivi stats [periode] (idée SYS+ n°5) : qui travaille vraiment dans le staff.
// Lecture seule, à partir de données qui existent déjà : sanctions, commandes et refus de
// quota (base centrale, 5 bots), tickets pris en charge et temps en vocal (ce bot).
import { EmbedBuilder } from "discord.js";
import { db, tableExists } from "../../database.js";
import { loadCentralStaffActivity } from "../../shared/staff-stats.js";
import { isStaffForFreeze } from "../../staff-freeze-gate.js";
import { recordSysPlusAudit } from "./audit.js";

const DAY = 86_400_000;
const ICONS = { warn: "⚠️", tempmute: "🔇", kick: "👢", ban: "🔨", blacklist: "⛔", unmute: "🔊", unban: "♻️" };

function localActivity(guildId, since) {
  const tickets = tableExists("tickets")
    ? db.prepare("SELECT claimed_by AS user_id, COUNT(*) AS n FROM tickets WHERE guild_id=? AND claimed_by IS NOT NULL AND created_at>? GROUP BY claimed_by").all(guildId, since)
    : [];
  const voice = tableExists("voice_sessions")
    ? db.prepare("SELECT user_id, SUM(COALESCE(duration_ms,0)) AS ms FROM voice_sessions WHERE guild_id=? AND joined_at>? GROUP BY user_id").all(guildId, since)
    : [];
  return {
    tickets: tickets.map((r) => ({ userId: r.user_id, count: Number(r.n) })),
    voice: voice.map((r) => ({ userId: r.user_id, minutes: Math.round(Number(r.ms) / 60_000) })),
  };
}

/** Fusion pure : une ligne par membre du staff (et par modérateur vu dans les sanctions). */
export function buildStaffStats({ staffIds = [], central = null, local = { tickets: [], voice: [] } }) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { userId: id, sanctions: {}, sanctionTotal: 0, commands: 0, refusals: 0, tickets: 0, voiceMinutes: 0, last: 0, staff: false });
    return rows.get(id);
  };
  for (const id of staffIds) row(id).staff = true;
  for (const s of central?.sanctions ?? []) {
    const r = row(s.userId);
    r.sanctions[s.action] = (r.sanctions[s.action] ?? 0) + s.count;
    r.sanctionTotal += s.count;
    r.last = Math.max(r.last, s.last);
  }
  for (const u of central?.usage ?? []) { const r = row(u.userId); r.commands += u.count; r.last = Math.max(r.last, u.last); }
  for (const v of central?.violations ?? []) if (rows.has(v.userId)) rows.get(v.userId).refusals += v.count;
  for (const t of local.tickets) if (rows.has(t.userId) || staffIds.includes(t.userId)) row(t.userId).tickets += t.count;
  for (const v of local.voice) if (rows.has(v.userId)) rows.get(v.userId).voiceMinutes += v.minutes;
  // Les simples membres qui ont tapé une commande ne sont pas du staff : on ne garde que le staff et ceux qui ont sanctionné.
  const list = [...rows.values()].filter((r) => r.staff || r.sanctionTotal > 0);
  for (const r of list) r.inactive = r.sanctionTotal === 0 && r.commands === 0 && r.tickets === 0;
  return list.sort((a, b) => (b.sanctionTotal + b.tickets) - (a.sanctionTotal + a.tickets) || b.commands - a.commands);
}

const hours = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`);

export function formatStaffLine(r) {
  const sanctions = Object.entries(r.sanctions).map(([a, n]) => `${ICONS[a] ?? "•"}${n}`).join(" ") || "aucune sanction";
  return `<@${r.userId}> · ${sanctions} · 🎫 ${r.tickets} · 🎙️ ${hours(r.voiceMinutes)} · ⌨️ ${r.commands}${r.refusals ? ` · ⛔ ${r.refusals} refus de quota` : ""}${r.last ? ` · dernière action <t:${Math.floor(r.last / 1000)}:R>` : ""}${r.staff ? "" : " · *(hors staff)*"}`;
}

export function staffStatsEmbed(rows, { days, centralAvailable }) {
  const active = rows.filter((r) => !r.inactive);
  const inactive = rows.filter((r) => r.inactive);
  const lines = active.slice(0, 20).map(formatStaffLine);
  const description = [
    lines.length ? lines.join("\n") : "Aucune activité du staff sur la période.",
    active.length > 20 ? `… et ${active.length - 20} autre(s).` : null,
    inactive.length ? `\n💤 **Inactifs sur ${days} j** (${inactive.length}) : ${inactive.slice(0, 30).map((r) => `<@${r.userId}>`).join(" ")}` : null,
    centralAvailable ? null : "\n⚠️ Base centrale injoignable : sanctions, commandes et refus de quota manquent.",
  ].filter(Boolean).join("\n");
  return new EmbedBuilder().setColor(0x0ea5e9)
    .setTitle(`📊 Activité du staff · ${days} derniers jours`)
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: "⚠️ avert. 🔇 mute 👢 kick 🔨 ban · 🎫 tickets pris · 🎙️ vocal · ⌨️ commandes · lecture seule" });
}

/** Lignes d'activité du staff d'un serveur sur `days` jours (base centrale facultative). */
export async function collectStaffRows(guild, settings, days) {
  await guild.members.fetch().catch(() => null);
  const staffIds = [];
  for (const m of guild.members.cache.values()) {
    if (m.user?.bot) continue;
    if (await isStaffForFreeze(m, settings).catch(() => false)) staffIds.push(m.id);
  }
  let central = null;
  try { central = await loadCentralStaffActivity(guild.id, days); } catch { central = null; }
  return { rows: buildStaffStats({ staffIds, central, local: localActivity(guild.id, Date.now() - days * DAY) }), centralAvailable: Boolean(central) };
}

export async function handleStaffStatsCommand(interaction, { member, roleId, isSysPlus, isOwner, settings }) {
  if (!isOwner && !isSysPlus(member, roleId)) {
    await interaction.reply({ content: "⛔ Réservé aux SYS+ et à l'owner.", ephemeral: true });
    return true;
  }
  const days = interaction.options.getString("periode") === "30j" ? 30 : 7;
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const { rows, centralAvailable } = await collectStaffRows(guild, settings, days);
  try { recordSysPlusAudit(guild.id, interaction.user.id, "staff.stats", null, { days }); } catch { /* lecture quand même */ }
  await interaction.editReply({ embeds: [staffStatsEmbed(rows, { days, centralAvailable })], allowedMentions: { parse: [] } });
  return true;
}
