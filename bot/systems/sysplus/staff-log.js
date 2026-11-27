// SYS+ — main courante du staff (/courante). Un journal de bord partagé : chaque membre du staff y écrit
// ce qui s'est passé pendant sa garde (« raid repoussé à 22 h », « litige ticket #12 réglé »), le suivant le relit.
// Texte libre de 400 caractères au plus (rappel : pas de données sensibles), conservé 90 jours.
// Visible du staff seulement (même définition que le gel d'urgence) ; une entrée se retire par son auteur ou un admin.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../../database.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";
import { isStaffForFreeze } from "../../staff-freeze-gate.js";

export const STAFF_LOG_COMMANDS = new Set(["courante"]);
export const STAFF_LOG = Object.freeze({ maxLength: 400, retentionMs: 90 * 86_400_000, perAuthorPerDay: 30, defaultDays: 2, maxRows: 25 });

db.exec(`CREATE TABLE IF NOT EXISTS staff_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS staff_log_guild_idx ON staff_log(guild_id, created_at DESC);`);

export function addLogEntry({ guildId, authorId, body, now = Date.now() }) {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Écris quelque chose.");
  if (text.length > STAFF_LOG.maxLength) throw new Error(`${STAFF_LOG.maxLength} caractères au plus.`);
  const today = Number(db.prepare("SELECT COUNT(*) AS n FROM staff_log WHERE guild_id=? AND author_id=? AND created_at>?").get(guildId, authorId, now - 86_400_000).n);
  if (today >= STAFF_LOG.perAuthorPerDay) throw new Error("Trop d'entrées en 24 h.");
  db.prepare("DELETE FROM staff_log WHERE created_at<?").run(now - STAFF_LOG.retentionMs);
  return Number(db.prepare("INSERT INTO staff_log(guild_id,author_id,body,created_at) VALUES(?,?,?,?)").run(guildId, authorId, text, now).lastInsertRowid);
}

export function readLog(guildId, { days = STAFF_LOG.defaultDays, now = Date.now() } = {}) {
  const span = Math.min(30, Math.max(1, Number(days) || STAFF_LOG.defaultDays));
  return db.prepare("SELECT id,author_id,body,created_at FROM staff_log WHERE guild_id=? AND created_at>? ORDER BY id DESC LIMIT ?")
    .all(guildId, now - span * 86_400_000, STAFF_LOG.maxRows).reverse();
}

/** Retire une entrée : son auteur ou un admin. Rend true si retirée. */
export function removeLogEntry({ guildId, id, actorId, isAdmin = false }) {
  const row = db.prepare("SELECT author_id FROM staff_log WHERE guild_id=? AND id=?").get(guildId, Number(id));
  if (!row) throw new Error("Entrée introuvable.");
  if (row.author_id !== actorId && !isAdmin) throw new Error("Seul l'auteur ou un admin peut retirer une entrée.");
  return Number(db.prepare("DELETE FROM staff_log WHERE guild_id=? AND id=?").run(guildId, Number(id)).changes) > 0;
}

export function formatLog(rows, days) {
  if (!rows.length) return `📒 Main courante vide sur les ${days} derniers jours.`;
  return `📒 **Main courante du staff** (${days} derniers jours)\n${rows.map((r) => `\`#${r.id}\` <t:${Math.floor(r.created_at / 1000)}:d> <t:${Math.floor(r.created_at / 1000)}:t> · <@${r.author_id}> : ${r.body}`).join("\n")}`.slice(0, 4000);
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleStaffLogInteraction(interaction, { getSettings = () => null, now = Date.now() } = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "courante" || !interaction.guild) return false;
  const guild = interaction.guild;
  try {
    const member = interaction.member ?? await guild.members.fetch(interaction.user.id);
    if (!isAdmin(member) && !(await isStaffForFreeze(member, getSettings(guild.id)).catch(() => false))) throw new Error("Réservé au staff.");
    const sub = interaction.options.getSubcommand(false) ?? "voir";
    let content;
    if (sub === "ajouter") {
      const id = addLogEntry({ guildId: guild.id, authorId: interaction.user.id, body: interaction.options.getString("texte", true), now });
      content = `📒 Entrée \`#${id}\` ajoutée à la main courante. Pas de données sensibles dedans (mots de passe, infos privées).`;
    } else if (sub === "retirer") {
      removeLogEntry({ guildId: guild.id, id: interaction.options.getInteger("id", true), actorId: interaction.user.id, isAdmin: isAdmin(member) });
      content = "🗑️ Entrée retirée.";
    } else {
      const days = interaction.options.getInteger("jours", false) ?? STAFF_LOG.defaultDays;
      content = formatLog(readLog(guild.id, { days, now }), Math.min(30, Math.max(1, days)));
    }
    await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
