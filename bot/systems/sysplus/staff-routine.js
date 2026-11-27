// SYS+ — rapport hebdomadaire du staff (chaque lundi dès 9 h, heure de Paris) et alerte d'inactivité
// (membre du staff sans aucune action depuis 14 jours). Réglage : /rapportstaff (admins).
// Lecture seule : réutilise les chiffres de /sysp suivi stats, rien n'est sanctionné ni retiré ici.
import { EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { db } from "../../database.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";
import { collectStaffRows, staffStatsEmbed } from "./staff-stats.js";

export const STAFF_ROUTINE_COMMANDS = new Set(["rapportstaff"]);
export const STAFF_ROUTINE = Object.freeze({ reportHour: 9, inactiveDays: 14, realertMs: 14 * 86_400_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS sysplus_routine (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_report TEXT, last_inactivity TEXT);
  CREATE TABLE IF NOT EXISTS sysplus_inactivity_alerts (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, alerted_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
`);

/** Date, heure et jour de la semaine à Paris. weekday : 1 = lundi … 7 = dimanche. */
export function parisClock(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday };
}

export function routineConfig(guildId) {
  const row = db.prepare("SELECT * FROM sysplus_routine WHERE guild_id=?").get(guildId);
  return row ? { channelId: row.channel_id, enabled: Boolean(row.enabled), lastReport: row.last_report, lastInactivity: row.last_inactivity } : null;
}

export function configureRoutine(guildId, channelId) {
  if (!channelId) throw new Error("Choisis un salon.");
  db.prepare(`INSERT INTO sysplus_routine(guild_id,channel_id,enabled) VALUES(?,?,1) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, enabled=1`).run(guildId, channelId);
  return routineConfig(guildId);
}

export function disableRoutine(guildId) {
  return Number(db.prepare("UPDATE sysplus_routine SET enabled=0 WHERE guild_id=?").run(guildId).changes) > 0;
}

/** Membres du staff inactifs à alerter (pas déjà alertés dans les 14 derniers jours). */
export function inactiveToAlert(guildId, rows, now = Date.now()) {
  return rows.filter((r) => r.staff && r.inactive).filter((r) => {
    const last = db.prepare("SELECT alerted_at FROM sysplus_inactivity_alerts WHERE guild_id=? AND user_id=?").get(guildId, r.userId);
    return !last || now - last.alerted_at >= STAFF_ROUTINE.realertMs;
  });
}

/**
 * Passage horaire. Rapport : lundi, à partir de 9 h, une fois par jour de rapport.
 * Inactivité : tous les jours à partir de 9 h. `getSettings(guildId)` donne les réglages du serveur.
 * Rend { reports, alerts }.
 */
export async function runStaffRoutine(client, { isAllowedGuild = () => true, getSettings = () => null, now = Date.now() } = {}) {
  const out = { reports: 0, alerts: 0 };
  const clock = parisClock(now);
  if (clock.hour < STAFF_ROUTINE.reportHour) return out;
  for (const { guild_id: guildId } of db.prepare("SELECT guild_id FROM sysplus_routine WHERE enabled=1").all()) {
    const guild = isAllowedGuild(guildId) ? client.guilds.cache.get(guildId) : null;
    if (!guild) continue;
    const config = routineConfig(guildId);
    const channel = guild.channels.cache.get(config.channelId) ?? await guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel?.send) continue;
    if (clock.weekday === 1 && config.lastReport !== clock.date) {
      db.prepare("UPDATE sysplus_routine SET last_report=? WHERE guild_id=?").run(clock.date, guildId);
      const { rows, centralAvailable } = await collectStaffRows(guild, getSettings(guildId), 7);
      await channel.send({ content: "📅 **Rapport hebdomadaire du staff**", embeds: [staffStatsEmbed(rows, { days: 7, centralAvailable })], allowedMentions: { parse: [] } }).catch(() => {});
      out.reports += 1;
    }
    if (config.lastInactivity !== clock.date) {
      db.prepare("UPDATE sysplus_routine SET last_inactivity=? WHERE guild_id=?").run(clock.date, guildId);
      const { rows } = await collectStaffRows(guild, getSettings(guildId), STAFF_ROUTINE.inactiveDays);
      const due = inactiveToAlert(guildId, rows, now);
      if (due.length) {
        for (const r of due) db.prepare("INSERT OR REPLACE INTO sysplus_inactivity_alerts(guild_id,user_id,alerted_at) VALUES(?,?,?)").run(guildId, r.userId, now);
        const embed = new EmbedBuilder().setColor(0x6b7280).setTitle(`💤 Staff inactif depuis ${STAFF_ROUTINE.inactiveDays} jours`)
          .setDescription(`${due.slice(0, 30).map((r) => `<@${r.userId}>`).join(" ")}\nAucune sanction, commande de modération ni ticket pris en charge sur la période. À contacter avant de décider quoi que ce soit.`);
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
        out.alerts += due.length;
      }
    }
  }
  return out;
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleStaffRoutineInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "rapportstaff" || !interaction.guild) return false;
  const gid = interaction.guild.id;
  try {
    if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
    const sub = interaction.options.getSubcommand(false) ?? "etat";
    let content;
    if (sub === "configurer") {
      const config = configureRoutine(gid, interaction.options.getChannel("salon", true).id);
      content = `📅 Rapport du staff chaque lundi à 9 h et alerte d'inactivité (${STAFF_ROUTINE.inactiveDays} jours) dans <#${config.channelId}>. Choisis un salon réservé au staff.`;
    } else if (sub === "desactiver") {
      content = disableRoutine(gid) ? "🔕 Rapport et alerte d'inactivité désactivés." : "Rien n'était configuré.";
    } else {
      const config = routineConfig(gid);
      content = config ? `📅 Rapport du staff : <#${config.channelId}> · ${config.enabled ? "actif" : "désactivé"}` : "Aucun rapport configuré (`/rapportstaff configurer`).";
    }
    await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
