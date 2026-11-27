// SUCK ME — compte à rebours d'événement (/decompte), complément de /event.
//   /decompte demarrer id salon : publie un message qui se met à jour toutes les 5 minutes (temps restant,
//   inscrits) et prévient les inscrits à J-1 puis à H-1. Il se fige au début de l'événement (le message
//   « commence maintenant » reste celui de /event). /decompte arreter id : coupe le compte à rebours.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { listCommunityEventSignups } from "../organization.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const COUNTDOWN_COMMANDS = new Set(["decompte"]);
export const COUNTDOWN = Object.freeze({ refreshMs: 5 * 60_000, dayMs: 86_400_000, hourMs: 3_600_000, maxMentions: 30, maxActive: 5 });

db.exec(`CREATE TABLE IF NOT EXISTS event_countdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, event_id INTEGER NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
  pinged_d1 INTEGER NOT NULL DEFAULT 0, pinged_h1 INTEGER NOT NULL DEFAULT 0, last_refresh INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
)`);

/** « 2 j 3 h », « 45 min », « moins d'une minute ». */
export function remainingText(ms) {
  if (ms <= 0) return "maintenant";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "moins d'une minute";
  const d = Math.floor(minutes / 1_440); const h = Math.floor((minutes % 1_440) / 60); const m = minutes % 60;
  return [d ? `${d} j` : "", h ? `${h} h` : "", !d && m ? `${m} min` : ""].filter(Boolean).join(" ");
}

export function countdownContent(event, signups, now = Date.now()) {
  const unix = Math.floor(event.starts_at / 1000);
  return `⏳ **${event.title}**\nDébut <t:${unix}:F> (<t:${unix}:R>)\nTemps restant : **${remainingText(event.starts_at - now)}** · inscrits : **${signups}**${event.description ? `\n${String(event.description).slice(0, 300)}` : ""}\nInscris-toi avec \`/event\`.`;
}

export function startCountdown({ guildId, eventId, channelId }, now = Date.now()) {
  const event = db.prepare("SELECT * FROM events WHERE guild_id=? AND id=? AND cancelled_at IS NULL").get(guildId, eventId);
  if (!event || event.starts_at <= now) throw new Error("Événement introuvable, annulé ou déjà commencé.");
  if (db.prepare("SELECT 1 FROM event_countdowns WHERE guild_id=? AND event_id=? AND status='active'").get(guildId, eventId)) throw new Error("Cet événement a déjà un compte à rebours.");
  const active = Number(db.prepare("SELECT COUNT(*) AS n FROM event_countdowns WHERE guild_id=? AND status='active'").get(guildId).n);
  if (active >= COUNTDOWN.maxActive) throw new Error(`${COUNTDOWN.maxActive} comptes à rebours actifs au plus.`);
  // Déjà passé J-1 / H-1 à la création : on ne prévient pas pour un seuil dépassé.
  const left = event.starts_at - now;
  const info = db.prepare("INSERT INTO event_countdowns(guild_id,event_id,channel_id,pinged_d1,pinged_h1,created_at) VALUES(?,?,?,?,?,?)")
    .run(guildId, eventId, channelId, left <= COUNTDOWN.dayMs ? 1 : 0, left <= COUNTDOWN.hourMs ? 1 : 0, now);
  return { id: Number(info.lastInsertRowid), event };
}

export function stopCountdown(guildId, eventId) {
  return Number(db.prepare("UPDATE event_countdowns SET status='stopped' WHERE guild_id=? AND event_id=? AND status='active'").run(guildId, eventId).changes) > 0;
}

/** Passage (chaque minute) : met à jour les messages, prévient à J-1 et H-1, fige les événements commencés. */
export async function runCountdowns(client, { isAllowedGuild = () => true, now = Date.now() } = {}) {
  const out = { refreshed: 0, pings: 0 };
  for (const row of db.prepare("SELECT * FROM event_countdowns WHERE status='active'").all()) {
    const guild = isAllowedGuild(row.guild_id) ? client.guilds.cache.get(row.guild_id) : null;
    if (!guild) continue;
    const event = db.prepare("SELECT * FROM events WHERE guild_id=? AND id=?").get(row.guild_id, row.event_id);
    const channel = guild.channels.cache.get(row.channel_id) ?? await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!event || event.cancelled_at != null || !channel) { db.prepare("UPDATE event_countdowns SET status='stopped' WHERE id=?").run(row.id); continue; }
    const signupIds = listCommunityEventSignups(row.guild_id, row.event_id).map((s) => s.userId);
    const left = event.starts_at - now;
    for (const [flag, threshold, label] of [["pinged_d1", COUNTDOWN.dayMs, "demain"], ["pinged_h1", COUNTDOWN.hourMs, "dans moins d'une heure"]]) {
      if (left > 0 && left <= threshold && !row[flag]) {
        db.prepare(`UPDATE event_countdowns SET ${flag}=1 WHERE id=? AND ${flag}=0`).run(row.id);
        const mentions = signupIds.slice(0, COUNTDOWN.maxMentions);
        await channel.send({ content: `🔔 **${event.title}** commence ${label} (<t:${Math.floor(event.starts_at / 1000)}:R>) !${mentions.length ? `\n${mentions.map((id) => `<@${id}>`).join(" ")}` : ""}`, allowedMentions: { users: mentions } }).catch(() => {});
        out.pings += 1;
      }
    }
    const finished = left <= 0;
    if (finished || now - row.last_refresh >= COUNTDOWN.refreshMs) {
      const content = finished ? `📅 **${event.title}** a commencé ! Merci à ${signupIds.length} inscrit${signupIds.length > 1 ? "s" : ""}.` : countdownContent(event, signupIds.length, now);
      let message = row.message_id ? await channel.messages?.fetch?.(row.message_id).catch(() => null) : null;
      if (message) await message.edit({ content, allowedMentions: { parse: [] } }).catch(() => {});
      else {
        message = await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
        if (message) db.prepare("UPDATE event_countdowns SET message_id=? WHERE id=?").run(message.id, row.id);
      }
      db.prepare("UPDATE event_countdowns SET last_refresh=?, status=? WHERE id=?").run(now, finished ? "done" : "active", row.id);
      out.refreshed += 1;
    }
  }
  return out;
}

const isStaff = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.ManageEvents) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleCountdownInteraction(interaction, now = Date.now()) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "decompte" || !interaction.guild) return false;
  const o = interaction.options;
  try {
    if (!isStaff(interaction.member)) throw new Error("Réservé au staff (Gérer le serveur ou Gérer les événements).");
    const sub = o.getSubcommand(false) ?? "demarrer";
    const eventId = o.getInteger("id", true);
    if (sub === "arreter") {
      await interaction.reply({ content: stopCountdown(interaction.guild.id, eventId) ? `🛑 Compte à rebours de l'événement #${eventId} arrêté.` : `Aucun compte à rebours actif pour l'événement #${eventId}.`, ephemeral: true });
    } else {
      const channel = o.getChannel("salon", true);
      startCountdown({ guildId: interaction.guild.id, eventId, channelId: channel.id }, now);
      await interaction.reply({ content: `⏳ Compte à rebours lancé dans <#${channel.id}> : message mis à jour toutes les 5 min, rappel aux inscrits à J-1 et H-1. Il me faut **Envoyer des messages** dans ce salon.`, ephemeral: true, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
