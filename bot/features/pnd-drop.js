// LE FISC — largage PND (/largage) : un coffre tombe au hasard dans un salon actif ; le premier qui clique gagne.
//   Un salon est « actif » quand 3 membres au moins y ont écrit (5 messages au moins) ces 10 dernières minutes.
//   Délai aléatoire de 2 h à 5 h entre deux largages, montant tiré entre le minimum et le maximum choisis,
//   le coffre expire au bout de 2 minutes. Un membre ne gagne pas deux coffres de suite.
import { db } from "../database.js";
import { grantPnd } from "../economy.js";
import { respondInPlaceSafe } from "../interaction-reply.js";
import { PermissionFlagsBits as P } from "discord.js";

export const DROP_COMMANDS = new Set(["largage"]);
export const DROP = Object.freeze({ windowMs: 10 * 60_000, minMessages: 5, minAuthors: 3, minGapMs: 2 * 3_600_000, maxGapMs: 5 * 3_600_000, ttlMs: 2 * 60_000, defaultMin: 50, defaultMax: 300, maxAmount: 10_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS fisc_drop_config (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, min_amount INTEGER NOT NULL DEFAULT 50, max_amount INTEGER NOT NULL DEFAULT 300, next_at INTEGER NOT NULL DEFAULT 0, last_winner TEXT);
  CREATE TABLE IF NOT EXISTS fisc_drops (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', winner_id TEXT, created_at INTEGER NOT NULL, closed_at INTEGER);
`);

const fmt = (n) => `${Number(n).toLocaleString("fr-FR")} PND`;
const activity = new Map(); // channelId → [{ at, userId }]

export function noteActivity(message, now = Date.now()) {
  if (!message?.guild || message.author?.bot || message.system) return;
  const list = activity.get(message.channelId) ?? [];
  list.push({ at: now, userId: message.author.id });
  while (list.length && list[0].at < now - DROP.windowMs) list.shift();
  if (list.length > 200) list.splice(0, list.length - 200);
  activity.set(message.channelId, list);
}

export function forgetActivity() { activity.clear(); }

/** Salon le plus actif de la liste, ou null si aucun ne dépasse les seuils. */
export function pickChannel(channelIds, now = Date.now()) {
  let best = null;
  for (const channelId of channelIds) {
    const recent = (activity.get(channelId) ?? []).filter((m) => m.at >= now - DROP.windowMs);
    const authors = new Set(recent.map((m) => m.userId)).size;
    if (recent.length >= DROP.minMessages && authors >= DROP.minAuthors && (!best || recent.length > best.count)) best = { channelId, count: recent.length };
  }
  return best?.channelId ?? null;
}

export function dropConfig(guildId) {
  const row = db.prepare("SELECT * FROM fisc_drop_config WHERE guild_id=?").get(guildId);
  return { enabled: Boolean(row?.enabled), min: row?.min_amount ?? DROP.defaultMin, max: row?.max_amount ?? DROP.defaultMax, nextAt: row?.next_at ?? 0, lastWinner: row?.last_winner ?? null };
}

export function configureDrop(guildId, { enabled, min, max }, now = Date.now()) {
  const cur = dropConfig(guildId);
  const next = { enabled: enabled ?? cur.enabled, min: min ?? cur.min, max: max ?? cur.max };
  if (!(Number.isSafeInteger(next.min) && Number.isSafeInteger(next.max) && next.min >= 1 && next.max >= next.min && next.max <= DROP.maxAmount)) throw new Error(`Montants : de 1 à ${fmt(DROP.maxAmount)}, le maximum au moins égal au minimum.`);
  const nextAt = enabled && !cur.enabled ? now + DROP.minGapMs : cur.nextAt;
  db.prepare(`INSERT INTO fisc_drop_config(guild_id,enabled,min_amount,max_amount,next_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, min_amount=excluded.min_amount, max_amount=excluded.max_amount, next_at=excluded.next_at`)
    .run(guildId, next.enabled ? 1 : 0, next.min, next.max, nextAt);
  return dropConfig(guildId);
}

export const randomBetween = (min, max, rand = Math.random) => min + Math.floor(rand() * (max - min + 1));

/** Ouvre le coffre : le premier à cliquer (statut encore « open ») gagne. Rend { ok, message, amount }. */
export function claimDrop(dropId, userId, now = Date.now()) {
  const drop = db.prepare("SELECT * FROM fisc_drops WHERE id=?").get(Number(dropId));
  if (!drop) return { ok: false, message: "Coffre introuvable." };
  if (drop.status !== "open") return { ok: false, message: drop.status === "claimed" ? `Trop tard, <@${drop.winner_id}> a été plus rapide.` : "Ce coffre a expiré." };
  if (now - drop.created_at > DROP.ttlMs) { db.prepare("UPDATE fisc_drops SET status='expired', closed_at=? WHERE id=? AND status='open'").run(now, drop.id); return { ok: false, message: "Ce coffre a expiré." }; }
  if (dropConfig(drop.guild_id).lastWinner === userId) return { ok: false, message: "Tu as gagné le dernier coffre : laisse la chance aux autres cette fois." };
  const won = db.prepare("UPDATE fisc_drops SET status='claimed', winner_id=?, closed_at=? WHERE id=? AND status='open'").run(userId, now, drop.id);
  if (!Number(won.changes)) return { ok: false, message: "Trop tard, quelqu'un a été plus rapide." };
  grantPnd(drop.guild_id, userId, drop.amount, "drop_reward");
  db.prepare("UPDATE fisc_drop_config SET last_winner=? WHERE guild_id=?").run(userId, drop.guild_id);
  return { ok: true, amount: drop.amount, message: `🎁 <@${userId}> ouvre le coffre et empoche **${fmt(drop.amount)}** !` };
}

const dropRow = (id, disabled = false) => [{ type: 1, components: [{ type: 2, style: 3, label: "Ouvrir le coffre", emoji: { name: "🎁" }, custom_id: `drop:claim:${id}`, disabled }] }];

/**
 * Passage planifié (chaque minute) : largue un coffre si c'est l'heure et qu'un salon est actif ;
 * ferme les coffres expirés (bouton grisé). `channelsOf(guild)` liste les salons texte candidats.
 */
export async function runPndDrops(client, { isAllowedGuild = () => true, now = Date.now(), rand = Math.random, channelsOf = (guild) => [...guild.channels.cache.filter((c) => c.isTextBased?.() && !c.isThread?.() && c.guild?.id === guild.id).keys()] } = {}) {
  for (const drop of db.prepare("SELECT * FROM fisc_drops WHERE status='open' AND created_at<?").all(now - DROP.ttlMs)) {
    db.prepare("UPDATE fisc_drops SET status='expired', closed_at=? WHERE id=? AND status='open'").run(now, drop.id);
    const channel = client.channels?.cache?.get(drop.channel_id);
    const message = drop.message_id ? await channel?.messages?.fetch?.(drop.message_id).catch(() => null) : null;
    await message?.edit?.({ content: "🎁 Le coffre s'est refermé, personne ne l'a ouvert à temps.", components: dropRow(drop.id, true) }).catch(() => {});
  }
  const dropped = [];
  for (const { guild_id: guildId } of db.prepare("SELECT guild_id FROM fisc_drop_config WHERE enabled=1 AND next_at<=?").all(now)) {
    const guild = isAllowedGuild(guildId) ? client.guilds.cache.get(guildId) : null;
    if (!guild) continue;
    const channelId = pickChannel(channelsOf(guild), now);
    if (!channelId) continue; // pas de salon actif : on réessaie à la minute suivante
    const config = dropConfig(guildId);
    const amount = randomBetween(config.min, config.max, rand);
    const info = db.prepare("INSERT INTO fisc_drops(guild_id,channel_id,amount,created_at) VALUES(?,?,?,?)").run(guildId, channelId, amount, now);
    const id = Number(info.lastInsertRowid);
    db.prepare("UPDATE fisc_drop_config SET next_at=? WHERE guild_id=?").run(now + randomBetween(DROP.minGapMs, DROP.maxGapMs, rand), guildId);
    const channel = guild.channels.cache.get(channelId);
    const sent = await channel?.send?.({ content: "🎁 **Un coffre vient de tomber !** Le premier qui l'ouvre gagne des PND (il se referme dans 2 minutes).", components: dropRow(id), allowedMentions: { parse: [] } }).catch(() => null);
    if (sent) db.prepare("UPDATE fisc_drops SET message_id=? WHERE id=?").run(sent.id, id);
    else db.prepare("UPDATE fisc_drops SET status='expired', closed_at=? WHERE id=?").run(now, id);
    dropped.push({ guildId, channelId, amount });
  }
  return dropped;
}

export async function handleDropButton(interaction, now = Date.now()) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith("drop:claim:")) return false;
  const result = claimDrop(interaction.customId.split(":")[2], interaction.user?.id, now);
  if (result.ok) await interaction.update({ content: result.message, components: dropRow(interaction.customId.split(":")[2], true), allowedMentions: { users: [interaction.user.id] } }).catch(() => {});
  else await interaction.reply({ content: `⚠️ ${result.message}`, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleDropInteraction(interaction, now = Date.now()) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "largage" || !interaction.guild) return false;
  const o = interaction.options;
  try {
    if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
    const sub = o.getSubcommand(false) ?? "etat";
    const config = sub === "configurer" ? configureDrop(interaction.guild.id, { min: o.getInteger("minimum", false) ?? undefined, max: o.getInteger("maximum", false) ?? undefined }, now)
      : sub === "activer" ? configureDrop(interaction.guild.id, { enabled: true }, now)
        : sub === "desactiver" ? configureDrop(interaction.guild.id, { enabled: false }, now)
          : dropConfig(interaction.guild.id);
    await interaction.reply({ content: `🎁 **Largage PND** : ${config.enabled ? "activé" : "désactivé"} · ${fmt(config.min)} à ${fmt(config.max)} · un coffre toutes les 2 à 5 h dans un salon actif (3 membres au moins sur 10 min).`, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
