// STAFF CENTER (SUCK ME) — dossiers d'intervention du staff (tâche 1.3).
//
// Un dossier regroupe une intervention : incident, enquête, plainte, raid… Il ne remplace pas
// les dossiers de sanction (`moderation_cases`, `/sanction`, `/dossier`) ni les appels
// (`moderation-appeals`) : il les RÉFÉRENCE (lien « sanction:12 », « journal:34 »).
//
// /staff intervention ouvrir · voir · liste · assigner · preuve · note · cloturer · valider
//
// Règles :
//  - staff seulement (échelle /staff, SYS+, OWNER configuré) ; données isolées par serveur ;
//  - numéro unique par serveur (n°1, n°2…) ; historique en ajout seul, jamais réécrit ;
//  - preuves : liens https, et liens de messages Discord du MÊME serveur uniquement ;
//  - priorité haute : la clôture passe en « à valider » et doit être validée par un AUTRE membre
//    habilité (SYS+ ou OWNER) que celui qui a demandé la clôture (validation secondaire) ;
//  - aucun dossier ne donne de rôle, ne sanctionne ni ne contacte un membre.
import { db as defaultDb } from "./database.js";

export const STATUSES = Object.freeze({ open: "ouvert", assigned: "en cours", pending: "à valider", closed: "clos" });
export const PRIORITIES = Object.freeze(["basse", "normale", "haute"]);
export const MAX_EVIDENCE = 20;
const TEXT_MAX = 500;

export function ensureInterventionTables(db = defaultDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_interventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL, number INTEGER NOT NULL,
      title TEXT NOT NULL, target_id TEXT, priority TEXT NOT NULL DEFAULT 'normale',
      status TEXT NOT NULL DEFAULT 'open', opened_by TEXT NOT NULL, assignee_id TEXT,
      close_requested_by TEXT, resolution TEXT, validated_by TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER,
      UNIQUE (guild_id, number)
    );
    CREATE INDEX IF NOT EXISTS staff_interventions_status ON staff_interventions(guild_id, status, updated_at);
    CREATE TABLE IF NOT EXISTS staff_intervention_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intervention_id INTEGER NOT NULL, guild_id TEXT NOT NULL,
      kind TEXT NOT NULL, actor_id TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS staff_intervention_events_case ON staff_intervention_events(intervention_id, id);
  `);
}

export const cleanText = (value, max = TEXT_MAX) => String(value ?? "")
  .replace(/@(everyone|here)/gi, "@​$1").replace(/<@&(\d+)>/g, "@rôle").replace(/\s+/g, " ").trim().slice(0, max);

/** https link, or a Discord message link of this same guild. Returns the normalised link or an error. */
export function checkEvidence(link, guildId) {
  const text = String(link ?? "").trim();
  let url;
  try { url = new URL(text); } catch { return { error: "Lien invalide (il faut une adresse https://…)." }; }
  if (url.protocol !== "https:") return { error: "Seuls les liens https sont acceptés." };
  if (text.length > 400) return { error: "Lien trop long." };
  const discord = /^(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com$/i.test(url.hostname);
  if (discord && url.pathname.startsWith("/channels/")) {
    const [, , linkGuild] = url.pathname.split("/");
    if (linkGuild !== String(guildId)) return { error: "Ce lien de message vient d'un autre serveur : refusé (les données de chaque serveur restent séparées)." };
  }
  return { link: url.toString() };
}

/** "sanction:12", "journal:34", "ticket:7" */
export function checkReference(value) {
  const m = String(value ?? "").trim().toLowerCase().match(/^(sanction|journal|ticket|appel)\s*[:#]?\s*(\d{1,9})$/);
  return m ? { reference: `${m[1]}:${Number(m[2])}` } : { error: "Référence attendue : sanction:12, journal:34, ticket:7 ou appel:3." };
}

function event(db, row, kind, actorId, detail = null, now = Date.now()) {
  db.prepare("INSERT INTO staff_intervention_events(intervention_id, guild_id, kind, actor_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.guild_id, kind, actorId, detail === null ? null : String(detail).slice(0, 600), now);
  db.prepare("UPDATE staff_interventions SET updated_at = ? WHERE id = ?").run(now, row.id);
}

function find(db, guildId, number) {
  return db.prepare("SELECT * FROM staff_interventions WHERE guild_id = ? AND number = ?").get(String(guildId), Number(number)) ?? null;
}

export function openIntervention({ guildId, actorId, title, targetId = null, priority = "normale" }, { db = defaultDb, now = Date.now() } = {}) {
  ensureInterventionTables(db);
  const cleanTitle = cleanText(title, 120);
  if (!cleanTitle) return { error: "Donne un titre au dossier." };
  const level = PRIORITIES.includes(priority) ? priority : "normale";
  db.exec("BEGIN IMMEDIATE");
  try {
    const next = Number(db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM staff_interventions WHERE guild_id = ?").get(String(guildId)).n);
    const id = Number(db.prepare(`INSERT INTO staff_interventions(guild_id, number, title, target_id, priority, status, opened_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(String(guildId), next, cleanTitle, targetId, level, actorId, now, now).lastInsertRowid);
    db.prepare("INSERT INTO staff_intervention_events(intervention_id, guild_id, kind, actor_id, detail, created_at) VALUES (?, ?, 'open', ?, ?, ?)").run(id, String(guildId), actorId, cleanTitle, now);
    db.exec("COMMIT");
    return { number: next, id, priority: level };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getIntervention(guildId, number, { db = defaultDb } = {}) {
  ensureInterventionTables(db);
  const row = find(db, guildId, number);
  if (!row) return null;
  const events = db.prepare("SELECT kind, actor_id, detail, created_at FROM staff_intervention_events WHERE intervention_id = ? ORDER BY id").all(row.id)
    .map((e) => ({ kind: e.kind, actorId: e.actor_id, detail: e.detail, at: Number(e.created_at) }));
  return { ...row, events };
}

export function listInterventions(guildId, { status = "actifs", db = defaultDb, limit = 15 } = {}) {
  ensureInterventionTables(db);
  const filter = status === "clos" ? "status = 'closed'" : status === "tous" ? "1 = 1" : status === "a_valider" ? "status = 'pending'" : "status != 'closed'";
  return db.prepare(`SELECT number, title, status, priority, assignee_id, updated_at FROM staff_interventions WHERE guild_id = ? AND ${filter}
    ORDER BY CASE priority WHEN 'haute' THEN 0 WHEN 'normale' THEN 1 ELSE 2 END, updated_at DESC LIMIT ?`).all(String(guildId), limit);
}

/** Every write goes through here: checks that the file exists and is not closed. */
function mutable(db, guildId, number) {
  const row = find(db, guildId, number);
  if (!row) return { error: `Dossier n°${number} introuvable sur ce serveur.` };
  if (row.status === "closed") return { error: `Le dossier n°${number} est clos.` };
  return { row };
}

export function assignIntervention({ guildId, number, actorId, assigneeId }, { db = defaultDb, now = Date.now() } = {}) {
  ensureInterventionTables(db);
  const { row, error } = mutable(db, guildId, number);
  if (error) return { error };
  if (row.status === "pending") return { error: "Le dossier attend une validation : impossible de le réattribuer avant." };
  db.prepare("UPDATE staff_interventions SET assignee_id = ?, status = 'assigned' WHERE id = ?").run(assigneeId, row.id);
  event(db, row, "assign", actorId, assigneeId, now);
  return { ok: true };
}

export function addEvidence({ guildId, number, actorId, link }, { db = defaultDb, now = Date.now() } = {}) {
  ensureInterventionTables(db);
  const { row, error } = mutable(db, guildId, number);
  if (error) return { error };
  const ref = /^(sanction|journal|ticket|appel)\b/i.test(String(link).trim()) ? checkReference(link) : null;
  const checked = ref ?? checkEvidence(link, guildId);
  if (checked.error) return { error: checked.error };
  const count = Number(db.prepare("SELECT COUNT(*) AS n FROM staff_intervention_events WHERE intervention_id = ? AND kind IN ('evidence', 'link')").get(row.id).n);
  if (count >= MAX_EVIDENCE) return { error: `Maximum ${MAX_EVIDENCE} preuves ou références par dossier.` };
  event(db, row, ref ? "link" : "evidence", actorId, checked.link ?? checked.reference, now);
  return { ok: true, value: checked.link ?? checked.reference };
}

export function addNote({ guildId, number, actorId, text }, { db = defaultDb, now = Date.now() } = {}) {
  ensureInterventionTables(db);
  const { row, error } = mutable(db, guildId, number);
  if (error) return { error };
  const note = cleanText(text);
  if (!note) return { error: "La note est vide." };
  event(db, row, "note", actorId, note, now);
  return { ok: true };
}

/**
 * Close request. canManage = SYS+ / OWNER. Only the assignee, the opener or a manager may ask.
 * High priority → status "pending" until another manager validates.
 */
export function closeIntervention({ guildId, number, actorId, resolution, canManage = false }, { db = defaultDb, now = Date.now() } = {}) {
  ensureInterventionTables(db);
  const { row, error } = mutable(db, guildId, number);
  if (error) return { error };
  if (row.status === "pending") return { error: "Clôture déjà demandée : elle attend la validation d'un autre responsable." };
  if (!canManage && actorId !== row.assignee_id && actorId !== row.opened_by) return { error: "Seuls la personne chargée du dossier, son auteur, un SYS+ ou l'OWNER peuvent le clore." };
  const text = cleanText(resolution);
  if (!text) return { error: "Indique la conclusion (ce qui a été fait)." };
  if (row.priority === "haute") {
    db.prepare("UPDATE staff_interventions SET status = 'pending', close_requested_by = ?, resolution = ? WHERE id = ?").run(actorId, text, row.id);
    event(db, row, "close_request", actorId, text, now);
    return { ok: true, pending: true };
  }
  db.prepare("UPDATE staff_interventions SET status = 'closed', close_requested_by = ?, resolution = ?, closed_at = ? WHERE id = ?").run(actorId, text, now, row.id);
  event(db, row, "close", actorId, text, now);
  return { ok: true, pending: false };
}

/** Secondary validation: a manager other than the one who asked for the closure. */
export function validateIntervention({ guildId, number, actorId, canManage = false }, { db = defaultDb, now = Date.now() } = {}) {
  ensureInterventionTables(db);
  const row = find(db, guildId, number);
  if (!row) return { error: `Dossier n°${number} introuvable sur ce serveur.` };
  if (row.status !== "pending") return { error: "Ce dossier n'attend pas de validation." };
  if (!canManage) return { error: "Validation réservée aux SYS+ et à l'OWNER." };
  if (actorId === row.close_requested_by) return { error: "La validation doit venir d'un autre responsable que celui qui a demandé la clôture." };
  db.prepare("UPDATE staff_interventions SET status = 'closed', validated_by = ?, closed_at = ? WHERE id = ?").run(actorId, now, row.id);
  event(db, row, "validate", actorId, null, now);
  return { ok: true };
}

const KIND_LABELS = { open: "📂 Ouvert", assign: "👤 Attribué à", evidence: "📎 Preuve", link: "🔗 Référence", note: "📝 Note", close_request: "⏳ Clôture demandée", close: "✅ Clos", validate: "✅ Validé et clos" };

export function formatIntervention(file) {
  const head = [
    `**Dossier n°${file.number}** — ${file.title}`,
    `Statut : **${STATUSES[file.status] ?? file.status}** · Priorité : ${file.priority}${file.target_id ? ` · Membre : <@${file.target_id}>` : ""}`,
    `Ouvert par <@${file.opened_by}> <t:${Math.floor(file.created_at / 1000)}:R>${file.assignee_id ? ` · Chargé : <@${file.assignee_id}>` : " · Personne n'est chargé du dossier"}`,
  ];
  const lines = file.events.slice(-15).map((e) => {
    const detail = e.kind === "assign" ? `<@${e.detail}>` : e.detail && e.kind !== "open" ? e.detail : "";
    return `<t:${Math.floor(e.at / 1000)}:d> ${KIND_LABELS[e.kind] ?? e.kind}${detail ? ` ${detail}` : ""} — <@${e.actorId}>`;
  });
  return `${head.join("\n")}\n\n${lines.join("\n")}`.slice(0, 1900);
}

/** Open files without any update for `staleMs` (for reminders and the command centre). */
export function staleInterventions({ db = defaultDb, now = Date.now(), staleMs = 48 * 3_600_000 } = {}) {
  ensureInterventionTables(db);
  return db.prepare("SELECT guild_id, number, title, assignee_id, opened_by, updated_at FROM staff_interventions WHERE status != 'closed' AND updated_at <= ?").all(now - staleMs);
}

export function interventionCounts(guildId, { db = defaultDb } = {}) {
  ensureInterventionTables(db);
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM staff_interventions WHERE guild_id = ? GROUP BY status").all(String(guildId));
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
