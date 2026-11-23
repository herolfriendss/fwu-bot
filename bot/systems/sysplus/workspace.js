import { randomUUID } from "node:crypto";
import { db, transaction } from "../../database.js";

const SNOWFLAKE = /^\d{5,25}$/;
const NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_BOOKS = 40;
const MAX_BODY = 6_000;

function assertGuild(guildId) {
  if (typeof guildId !== "string" || !SNOWFLAKE.test(guildId)) throw new Error("Serveur invalide.");
}
function assertActor(actorId) {
  if (typeof actorId !== "string" || !SNOWFLAKE.test(actorId)) throw new Error("Acteur invalide.");
}
function authorize(guildId, actorId, action, callback) {
  assertGuild(guildId); assertActor(actorId);
  if (typeof callback !== "function" || callback({ guildId, actorId, action }) !== true) {
    throw new Error("Action réservée au staff SYS+ autorisé.");
  }
}
function map(row) {
  return { id: row.book_id, guildId: row.guild_id, name: row.name, description: row.description,
    body: row.body, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

/** Saves reusable human-readable runbooks. It never executes Discord actions or shell commands. */
export function createCommandbook(guildId, actorId, { name, description, body }, { authorizeActor, now = Date.now() } = {}) {
  authorize(guildId, actorId, "sysplus.commandbook.create", authorizeActor);
  const safeName = String(name ?? "").trim().toLowerCase();
  const safeDescription = String(description ?? "").replace(/@/g, "＠").trim();
  const safeBody = String(body ?? "").replace(/@everyone/gi, "＠everyone").replace(/@here/gi, "＠here").trim();
  if (!NAME.test(safeName)) throw new Error("Nom invalide : 2 à 40 caractères, lettres minuscules, chiffres et tirets.");
  if (safeDescription.length < 5 || safeDescription.length > 180) throw new Error("Description : 5 à 180 caractères.");
  if (safeBody.length < 10 || safeBody.length > MAX_BODY) throw new Error("Contenu : 10 à 6 000 caractères.");
  const id = randomUUID();
  try {
    transaction(() => {
      db.prepare(`INSERT INTO sysplus_commandbooks(book_id,guild_id,name,description,body,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, guildId, safeName, safeDescription, safeBody, actorId, actorId, now, now);
      db.prepare(`DELETE FROM sysplus_commandbooks WHERE guild_id=? AND book_id NOT IN
        (SELECT book_id FROM sysplus_commandbooks WHERE guild_id=? ORDER BY updated_at DESC LIMIT ?)`)
        .run(guildId, guildId, MAX_BOOKS);
    });
  } catch (error) {
    if (String(error?.message).includes("UNIQUE")) throw new Error("Un runbook porte déjà ce nom sur ce serveur.");
    throw error;
  }
  return getCommandbook(guildId, id);
}

export function getCommandbook(guildId, idOrName) {
  assertGuild(guildId);
  const token = String(idOrName ?? "").trim();
  const row = db.prepare("SELECT * FROM sysplus_commandbooks WHERE guild_id=? AND (book_id=? OR name=?)")
    .get(guildId, token, token.toLowerCase());
  return row ? map(row) : null;
}

export function listCommandbooks(guildId, limit = 20) {
  assertGuild(guildId);
  return db.prepare("SELECT * FROM sysplus_commandbooks WHERE guild_id=? ORDER BY updated_at DESC LIMIT ?")
    .all(guildId, Math.max(1, Math.min(MAX_BOOKS, Number(limit) || 20))).map(map);
}

export function deleteCommandbook(guildId, actorId, idOrName, { authorizeActor, now = Date.now() } = {}) {
  authorize(guildId, actorId, "sysplus.commandbook.delete", authorizeActor);
  const item = getCommandbook(guildId, idOrName);
  if (!item) throw new Error("Runbook introuvable sur ce serveur.");
  const result = db.prepare("DELETE FROM sysplus_commandbooks WHERE guild_id=? AND book_id=?").run(guildId, item.id);
  if (!result.changes) throw new Error("Runbook déjà supprimé.");
  return { ...item, deletedAt: now };
}

/** Search only server-scoped SYS+ metadata; never reads messages, DMs or member private content. */
export function searchSysPlusWorkspace(guildId, query, { limit = 8 } = {}) {
  assertGuild(guildId);
  const terms = String(query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length || terms.join(" ").length < 2) throw new Error("Recherche trop courte.");
  const bounded = Math.max(1, Math.min(12, Number(limit) || 8));
  const books = listCommandbooks(guildId, MAX_BOOKS).map((item) => ({
    type: "runbook", id: item.id, title: item.name, summary: item.description,
    searchable: `${item.name} ${item.description} ${item.body}`.toLowerCase(), createdAt: item.updatedAt,
  }));
  const incidents = db.prepare("SELECT incident_id,title,summary,severity,status,updated_at FROM sysplus_incidents WHERE guild_id=? ORDER BY updated_at DESC LIMIT 100")
    .all(guildId).map((row) => ({ type: "incident", id: row.incident_id, title: row.title,
      summary: `${row.severity} · ${row.status} · ${row.summary}`, searchable: `${row.title} ${row.summary} ${row.severity} ${row.status}`.toLowerCase(), createdAt: Number(row.updated_at) }));
  const audit = db.prepare("SELECT id,action,target_id,details,created_at FROM sysplus_audit WHERE guild_id=? ORDER BY id DESC LIMIT 150")
    .all(guildId).map((row) => ({ type: "audit", id: String(row.id), title: row.action,
      summary: row.target_id ? `Cible ${row.target_id}` : "Entrée d'audit", searchable: `${row.action} ${row.target_id ?? ""} ${row.details ?? ""}`.toLowerCase(), createdAt: Number(row.created_at) }));
  return [...books, ...incidents, ...audit].map((item) => ({ ...item,
    score: terms.reduce((score, term) => score + (item.title.toLowerCase().includes(term) ? 4 : 0) + (item.searchable.includes(term) ? 1 : 0), 0),
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .slice(0, bounded).map(({ searchable, ...item }) => item);
}
