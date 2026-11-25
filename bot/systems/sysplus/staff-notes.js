// Notes privées du staff sur un membre (idée SYS+ n°9, fusionnée avec D3).
//
// Règles de l'Avocat du diable :
//  • visibles seulement par le staff (même définition que le gel d'urgence) ;
//  • chaque lecture est journalisée dans l'audit SYS+ ;
//  • conservation limitée : 1 an, puis suppression automatique ;
//  • pas de données sensibles (rappel affiché à chaque ajout).
// Une note se retire seulement par son auteur, un SYS+ ou l'owner ; le retrait est journalisé.
import { db } from "../../database.js";
import { recordSysPlusAudit } from "./audit.js";

export const NOTE_RETENTION_MS = 365 * 86_400_000;
export const NOTE_MAX_LENGTH = 500;
export const NOTES_PER_MEMBER_MAX = 50;

db.exec(`CREATE TABLE IF NOT EXISTS sysplus_member_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  author_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sysplus_member_notes_idx ON sysplus_member_notes(guild_id, user_id, id DESC);`);

export function addMemberNote({ guildId, userId, authorId, body, now = Date.now() }) {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 3) throw new Error("Note trop courte (3 caractères minimum).");
  if (text.length > NOTE_MAX_LENGTH) throw new Error(`Note trop longue (${NOTE_MAX_LENGTH} caractères maximum).`);
  const count = Number(db.prepare("SELECT COUNT(*) AS n FROM sysplus_member_notes WHERE guild_id=? AND user_id=?").get(guildId, userId).n);
  if (count >= NOTES_PER_MEMBER_MAX) throw new Error(`Ce membre a déjà ${NOTES_PER_MEMBER_MAX} notes : retire les plus anciennes d'abord.`);
  const id = Number(db.prepare("INSERT INTO sysplus_member_notes(guild_id,user_id,author_id,body,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, authorId, text, now).lastInsertRowid);
  recordSysPlusAudit(guildId, authorId, "note.ajout", userId, { noteId: id });
  return id;
}

/** Lecture : toujours journalisée (qui a lu les notes de qui). */
export function readMemberNotes({ guildId, userId, readerId, limit = 15, purpose = "note.lecture" }) {
  const rows = db.prepare("SELECT id, author_id, body, created_at FROM sysplus_member_notes WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?")
    .all(guildId, userId, Math.min(NOTES_PER_MEMBER_MAX, Math.max(1, limit)));
  recordSysPlusAudit(guildId, readerId, purpose, userId, { count: rows.length });
  return rows.map((row) => ({ id: Number(row.id), authorId: row.author_id, body: row.body, createdAt: Number(row.created_at) }));
}

export function countMemberNotes(guildId, userId) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM sysplus_member_notes WHERE guild_id=? AND user_id=?").get(guildId, userId).n);
}

/** Retrait : l'auteur, un SYS+ ou l'owner. Renvoie un message d'erreur ou la note retirée. */
export function removeMemberNote({ guildId, noteId, actorId, canModerate }) {
  const row = db.prepare("SELECT * FROM sysplus_member_notes WHERE guild_id=? AND id=?").get(guildId, noteId);
  if (!row) return "❌ Note introuvable sur ce serveur.";
  if (row.author_id !== actorId && !canModerate) return "⛔ Seuls l'auteur de la note, un SYS+ ou l'owner peuvent la retirer.";
  db.prepare("DELETE FROM sysplus_member_notes WHERE guild_id=? AND id=?").run(guildId, noteId);
  recordSysPlusAudit(guildId, actorId, "note.retrait", row.user_id, { noteId, author: row.author_id });
  return { id: Number(row.id), userId: row.user_id };
}

/** Purge des notes de plus d'un an. Renvoie le nombre supprimé. */
export function purgeOldNotes(now = Date.now()) {
  return Number(db.prepare("DELETE FROM sysplus_member_notes WHERE created_at < ?").run(now - NOTE_RETENTION_MS).changes ?? 0);
}

export function startNotesRetention({ record = () => {} } = {}) {
  const run = () => {
    try { if (purgeOldNotes() > 0) record("staff_notes_purged"); } catch { record("staff_notes_purge_error"); }
  };
  const first = setTimeout(run, 15 * 60_000);
  first.unref?.();
  const timer = setInterval(run, 24 * 3600_000);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

export function formatNotes(notes, userId) {
  if (!notes.length) return `Aucune note du staff sur <@${userId}>.`;
  return notes.map((n) => `**#${n.id}** · <t:${Math.floor(n.createdAt / 1000)}:d> · <@${n.authorId}>\n↳ ${n.body}`).join("\n").slice(0, 3900);
}

/**
 * /sysp suivi note-ajouter | notes | note-retirer.
 * isStaff(member) : définition commune du staff ; isSysPlusOrOwner : droit de retirer la note d'un autre.
 */
export async function handleStaffNotesCommand(interaction, { subcommand, member, isStaff, isSysPlusOrOwner }) {
  if (!(await isStaff(member))) {
    await interaction.reply({ content: "⛔ Les notes du staff sont réservées au staff.", ephemeral: true });
    return true;
  }
  const guildId = interaction.guildId;
  const actorId = interaction.user.id;
  let content;
  try {
    if (subcommand === "note-ajouter") {
      const user = interaction.options.getUser("membre", true);
      const id = addMemberNote({ guildId, userId: user.id, authorId: actorId, body: interaction.options.getString("texte", true) });
      content = `📝 Note **#${id}** ajoutée sur <@${user.id}>. Visible par le staff seulement, supprimée au bout d'un an.\nRappel : pas de données sensibles (santé, adresse, vie privée).`;
    } else if (subcommand === "notes") {
      const user = interaction.options.getUser("membre", true);
      const notes = readMemberNotes({ guildId, userId: user.id, readerId: actorId });
      content = `📝 **Notes du staff sur <@${user.id}>**\n${formatNotes(notes, user.id)}\n-# Cette lecture est notée dans l'audit SYS+.`;
    } else {
      const result = removeMemberNote({ guildId, noteId: interaction.options.getInteger("note", true), actorId, canModerate: isSysPlusOrOwner });
      content = typeof result === "string" ? result : `🗑️ Note **#${result.id}** retirée (journalisé).`;
    }
  } catch (error) {
    content = `❌ ${error.message}`;
  }
  await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  return true;
}
