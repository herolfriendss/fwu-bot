// Modmail (SUCK ME) : un membre écrit en message privé au bot, le staff lit et
// répond dans un fil privé côté serveur, les réponses repartent en MP.
//
// Règles :
// - Le salon modmail doit être invisible pour @everyone (vérifié à la
//   configuration et à chaque réponse) : seul le staff voit les fils.
// - Un seul ticket ouvert par membre, tous serveurs confondus : un MP ne peut
//   jamais partir vers le mauvais serveur. À l'ouverture, le membre choisit
//   explicitement le serveur avec un bouton.
// - Le contenu des messages n'est pas copié en base : il n'existe que dans le
//   fil du staff et dans les MP. La base ne garde que qui, où et quand.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_modmail_config (
    guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, anonymous INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS staff_modmail_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, closed_at INTEGER, closed_by TEXT
  );
  CREATE INDEX IF NOT EXISTS staff_modmail_tickets_user ON staff_modmail_tickets(user_id, status);
  CREATE INDEX IF NOT EXISTS staff_modmail_tickets_thread ON staff_modmail_tickets(thread_id);
  CREATE TABLE IF NOT EXISTS staff_modmail_blocks (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, blocked_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

export const MODMAIL_MAX_LENGTH = 1800;
export const MODMAIL_REOPEN_COOLDOWN_MS = 10 * 60_000;
export const MODMAIL_PENDING_TTL_MS = 5 * 60_000;
export const MODMAIL_BURST = { max: 5, windowMs: 30_000 };
const CDN = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

// ─── Configuration ───────────────────────────────────────────────────────────

export function modmailConfig(guildId) {
  const row = db.prepare("SELECT * FROM staff_modmail_config WHERE guild_id=?").get(guildId);
  return { channelId: row?.channel_id ?? null, enabled: row ? Boolean(row.enabled) : false, anonymous: row ? Boolean(row.anonymous) : true };
}

export function saveModmailConfig(guildId, patch) {
  const next = { ...modmailConfig(guildId), ...patch };
  db.prepare(`INSERT INTO staff_modmail_config(guild_id,channel_id,enabled,anonymous) VALUES(?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, enabled=excluded.enabled, anonymous=excluded.anonymous`)
    .run(guildId, next.channelId, next.enabled ? 1 : 0, next.anonymous ? 1 : 0);
  return modmailConfig(guildId);
}

/** Le salon est-il bien réservé au staff (invisible pour @everyone) ? */
export function isPrivateChannel(channel) {
  const everyone = channel?.guild?.roles?.everyone;
  if (!everyone || typeof channel?.permissionsFor !== "function") return false;
  return !channel.permissionsFor(everyone)?.has?.(P.ViewChannel);
}

/** Staff du modmail = qui voit le salon modmail (privé). */
export function canHandleModmail(member, channel) {
  if (!member || !channel || !isPrivateChannel(channel)) return false;
  return Boolean(channel.permissionsFor(member)?.has?.(P.ViewChannel));
}

export const isModmailBlocked = (guildId, userId) =>
  Boolean(db.prepare("SELECT 1 FROM staff_modmail_blocks WHERE guild_id=? AND user_id=?").get(guildId, userId));

export function blockModmail(guildId, userId, blockedBy, now = Date.now()) {
  db.prepare("INSERT OR IGNORE INTO staff_modmail_blocks(guild_id,user_id,blocked_by,created_at) VALUES(?,?,?,?)").run(guildId, userId, blockedBy, now);
}
export function unblockModmail(guildId, userId) {
  return Number(db.prepare("DELETE FROM staff_modmail_blocks WHERE guild_id=? AND user_id=?").run(guildId, userId).changes) > 0;
}

// ─── Tickets ─────────────────────────────────────────────────────────────────

export const openTicketOf = (userId) =>
  db.prepare("SELECT * FROM staff_modmail_tickets WHERE user_id=? AND status='open' ORDER BY id DESC LIMIT 1").get(userId) ?? null;
export const ticketByThread = (threadId) =>
  db.prepare("SELECT * FROM staff_modmail_tickets WHERE thread_id=? ORDER BY id DESC LIMIT 1").get(threadId) ?? null;

/** Pur côté Discord : peut-on ouvrir un ticket maintenant ? */
export function canOpenTicket(guildId, userId, now = Date.now()) {
  if (openTicketOf(userId)) return { ok: false, reason: "Tu as déjà une conversation ouverte avec un staff : écris simplement ici." };
  if (isModmailBlocked(guildId, userId)) return { ok: false, reason: "Le staff de ce serveur ne reçoit plus tes messages." };
  const last = db.prepare("SELECT closed_at FROM staff_modmail_tickets WHERE guild_id=? AND user_id=? AND status='closed' ORDER BY id DESC LIMIT 1").get(guildId, userId);
  if (last?.closed_at && now - Number(last.closed_at) < MODMAIL_REOPEN_COOLDOWN_MS) {
    return { ok: false, reason: `Tu pourras rouvrir une conversation <t:${Math.ceil((Number(last.closed_at) + MODMAIL_REOPEN_COOLDOWN_MS) / 1000)}:R>.` };
  }
  return { ok: true };
}

export function openTicket(guildId, userId, now = Date.now()) {
  const verdict = canOpenTicket(guildId, userId, now);
  if (!verdict.ok) throw new Error(verdict.reason);
  const info = db.prepare("INSERT INTO staff_modmail_tickets(guild_id,user_id,created_at) VALUES(?,?,?)").run(guildId, userId, now);
  return Number(info.lastInsertRowid);
}
export function attachThread(ticketId, threadId) {
  db.prepare("UPDATE staff_modmail_tickets SET thread_id=? WHERE id=?").run(threadId, ticketId);
}
export function dropTicket(ticketId) {
  db.prepare("DELETE FROM staff_modmail_tickets WHERE id=? AND thread_id IS NULL").run(ticketId);
}
export function closeTicket(ticketId, closedBy, now = Date.now()) {
  return Number(db.prepare("UPDATE staff_modmail_tickets SET status='closed', closed_at=?, closed_by=? WHERE id=? AND status='open'")
    .run(now, closedBy, ticketId).changes) > 0;
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Pur : texte borné + liens des pièces jointes (CDN Discord uniquement). */
export function relayBody(message) {
  const text = String(message?.content ?? "").trim();
  const files = [...(message?.attachments?.values?.() ?? [])]
    .filter((a) => { try { return CDN.has(new URL(a.url).hostname); } catch { return false; } })
    .slice(0, 5)
    .map((a) => `📎 [${String(a.name ?? "fichier").slice(0, 60)}](${a.url})`);
  const body = [text.length > MODMAIL_MAX_LENGTH ? `${text.slice(0, MODMAIL_MAX_LENGTH)}…` : text, ...files].filter(Boolean).join("\n");
  return body || null;
}

const bursts = new Map();
let lastBurstSweep = 0;
/** Oublie les membres sans MP récent : sans ce ménage, la table grandit à chaque nouvel expéditeur. */
function sweepBursts(now) {
  if (now - lastBurstSweep < MODMAIL_BURST.windowMs) return;
  lastBurstSweep = now;
  for (const [userId, list] of bursts) {
    if (!list.some((t) => now - t < MODMAIL_BURST.windowMs)) bursts.delete(userId);
  }
}
/** Nombre de membres suivis (tests). */
export const trackedBurstCount = () => bursts.size;
/** Pur (état en mémoire) : au plus 5 MP relayés par 30 s et par membre. */
export function allowBurst(userId, now = Date.now()) {
  sweepBursts(now);
  const list = (bursts.get(userId) ?? []).filter((t) => now - t < MODMAIL_BURST.windowMs);
  if (list.length >= MODMAIL_BURST.max) { bursts.set(userId, list); return false; }
  list.push(now);
  bursts.set(userId, list);
  return true;
}

const pending = new Map();
export function rememberPending(userId, body, now = Date.now()) { pending.set(userId, { body, at: now }); }
export function takePending(userId, now = Date.now()) {
  const entry = pending.get(userId);
  pending.delete(userId);
  return entry && now - entry.at < MODMAIL_PENDING_TTL_MS ? entry.body : null;
}

function memberEmbed(user, body) {
  return new EmbedBuilder().setColor(0x3b82f6).setAuthor({ name: `${user.username ?? "Membre"} · message reçu`, iconURL: user.displayAvatarURL?.() ?? undefined })
    .setDescription(body).setTimestamp(Date.now());
}

/** Choix du serveur, posé en MP quand le membre n'a pas de conversation ouverte. */
export function chooserPayload(guilds) {
  const row = new ActionRowBuilder().addComponents(
    ...guilds.slice(0, 4).map((g) => new ButtonBuilder().setCustomId(`mm:open:${g.id}`).setLabel(`Staff de ${String(g.name).slice(0, 60)}`).setStyle(ButtonStyle.Primary).setEmoji("📨")),
    new ButtonBuilder().setCustomId("mm:cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
  return {
    content: "📨 Veux-tu envoyer ce message au staff ? Choisis le serveur. Le staff verra ton nom ; tes messages suivants lui seront transmis jusqu'à la fin de la conversation.",
    components: [row],
  };
}

/**
 * MP reçu par le bot.
 * @param {object} message  message privé (discord.js)
 * @param {object} ctx      { client, guildAllowed(guildId) }
 * @returns {Promise<"relayed" | "chooser" | "none" | "throttled" | null>}
 */
export async function handleModmailDm(message, { client, guildAllowed }) {
  if (message?.author?.bot || message.guildId) return null;
  const body = relayBody(message);
  if (!body) return null;
  if (!allowBurst(message.author.id)) {
    await message.react("⏳").catch(() => {});
    return "throttled";
  }

  const ticket = openTicketOf(message.author.id);
  if (ticket?.thread_id) {
    const thread = await client.channels.fetch(ticket.thread_id).catch(() => null);
    if (!thread?.isTextBased?.()) {
      closeTicket(ticket.id, client.user?.id ?? "bot");
      await message.reply("⚠️ Ta conversation précédente n'existe plus côté staff. Renvoie ton message pour en ouvrir une nouvelle.").catch(() => {});
      return "none";
    }
    if (thread.archived) await thread.setArchived(false).catch(() => {});
    await thread.send({ embeds: [memberEmbed(message.author, body)], allowedMentions: { parse: [] } });
    await message.react("✅").catch(() => {});
    return "relayed";
  }

  const guilds = [];
  for (const guild of client.guilds.cache.values()) {
    if (!guildAllowed(guild.id)) continue;
    const config = modmailConfig(guild.id);
    if (!config.enabled || !config.channelId || isModmailBlocked(guild.id, message.author.id)) continue;
    const member = await guild.members.fetch(message.author.id).catch(() => null);
    if (member) guilds.push(guild);
  }
  if (!guilds.length) {
    await message.reply("Aucun de tes serveurs n'a activé le modmail. Contacte le staff directement sur le serveur.").catch(() => {});
    return "none";
  }
  rememberPending(message.author.id, body);
  await message.reply(chooserPayload(guilds)).catch(() => {});
  return "chooser";
}

/** Bouton « Staff de … » : ouvre le fil et transmet le premier message. */
export async function openFromButton(interaction, { client, guildAllowed }) {
  const guildId = interaction.customId.split(":")[2];
  const guild = guildAllowed(guildId) ? client.guilds.cache.get(guildId) : null;
  const config = guild ? modmailConfig(guildId) : null;
  if (!guild || !config?.enabled || !config.channelId) return interaction.update({ content: "❌ Le modmail de ce serveur n'est plus disponible.", components: [] });
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.update({ content: "❌ Tu n'es pas sur ce serveur.", components: [] });
  const body = takePending(interaction.user.id);
  if (!body) return interaction.update({ content: "⌛ Trop tard : renvoie ton message, puis choisis le serveur.", components: [] });
  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.threads || !isPrivateChannel(channel)) {
    return interaction.update({ content: "❌ Le modmail de ce serveur est mal configuré. Préviens le staff sur le serveur.", components: [] });
  }

  let ticketId;
  try { ticketId = openTicket(guildId, interaction.user.id); } catch (error) {
    return interaction.update({ content: `❌ ${error.message}`, components: [] });
  }
  try {
    const thread = await channel.threads.create({
      name: `📨 ${interaction.user.username ?? interaction.user.id}`.slice(0, 90),
      autoArchiveDuration: 1440,
      reason: `Modmail #${ticketId}`,
    });
    attachThread(ticketId, thread.id);
    const created = Math.floor(Number(interaction.user.createdTimestamp ?? Date.now()) / 1000);
    const joined = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
    await thread.send({
      embeds: [new EmbedBuilder().setColor(0x64748b).setTitle(`📨 Modmail #${ticketId}`).setDescription([
        `Membre : <@${interaction.user.id}> \`${interaction.user.id}\``,
        `Compte créé <t:${created}:R>${joined ? ` · arrivé <t:${joined}:R>` : ""}`,
        "Répondre : `/outils modmail repondre` dans ce fil · Fermer : `/outils modmail fermer`.",
        "Les messages écrits ici sans la commande **ne sont pas** envoyés au membre.",
      ].join("\n"))],
      allowedMentions: { parse: [] },
    });
    await thread.send({ embeds: [memberEmbed(interaction.user, body)], allowedMentions: { parse: [] } });
  } catch {
    dropTicket(ticketId);
    return interaction.update({ content: "❌ Impossible d'ouvrir la conversation (permissions du bot sur le serveur). Préviens le staff.", components: [] });
  }
  return interaction.update({ content: `✅ Message transmis au staff de **${guild.name}**. Les réponses arriveront ici. Tu peux continuer à écrire.`, components: [] });
}

/** /outils modmail repondre — dans le fil d'un ticket. */
export async function replyToMember(interaction, client, text, anonymousOverride = null) {
  const ticket = ticketByThread(interaction.channelId);
  if (!ticket || ticket.guild_id !== interaction.guildId) throw new Error("Utilise cette commande dans le fil d'une conversation modmail.");
  if (ticket.status !== "open") throw new Error("Cette conversation est fermée.");
  const parent = interaction.channel?.parent ?? null;
  if (!canHandleModmail(interaction.member, parent)) throw new Error("Réservé au staff qui voit le salon modmail (et ce salon doit rester privé).");
  const config = modmailConfig(interaction.guildId);
  const anonymous = anonymousOverride ?? config.anonymous;
  const clean = String(text ?? "").trim().slice(0, MODMAIL_MAX_LENGTH);
  if (!clean) throw new Error("Le message est vide.");
  const user = await client.users.fetch(ticket.user_id);
  const signature = anonymous ? `Staff de ${interaction.guild?.name ?? "ce serveur"}` : `${interaction.member?.displayName ?? interaction.user.username} · staff de ${interaction.guild?.name ?? "ce serveur"}`;
  try {
    await user.send({ embeds: [new EmbedBuilder().setColor(0x22c55e).setAuthor({ name: signature }).setDescription(clean).setTimestamp(Date.now())], allowedMentions: { parse: [] } });
  } catch {
    throw new Error("Le membre n'accepte plus les MP du bot : message non remis.");
  }
  return { signature, text: clean, anonymous };
}

/** /outils modmail fermer — dans le fil d'un ticket. */
export async function closeFromThread(interaction, client, reason = null) {
  const ticket = ticketByThread(interaction.channelId);
  if (!ticket || ticket.guild_id !== interaction.guildId) throw new Error("Utilise cette commande dans le fil d'une conversation modmail.");
  if (!canHandleModmail(interaction.member, interaction.channel?.parent ?? null)) throw new Error("Réservé au staff qui voit le salon modmail.");
  if (!closeTicket(ticket.id, interaction.user.id)) throw new Error("Cette conversation est déjà fermée.");
  const user = await client.users.fetch(ticket.user_id).catch(() => null);
  await user?.send({ content: `📪 Le staff de **${interaction.guild?.name ?? "ce serveur"}** a fermé la conversation${reason ? ` : ${String(reason).slice(0, 300)}` : ""}. Écris de nouveau ici si besoin.`, allowedMentions: { parse: [] } }).catch(() => {});
  return ticket;
}
