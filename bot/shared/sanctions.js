// FWU — sanctions prédéfinies de /tempmute et historique des sanctions.
// Les types (nom → durée) sont en base, par serveur, modifiables par les
// admins (palier 5 % ou plus haut). Chaque modification est journalisée.
import { sharedQuery, sharedTransaction } from "./db.js";

export const DEFAULT_SANCTION_TYPES = Object.freeze([
  { name: "Propos déplacés", durationSeconds: 10 * 60 },
  { name: "Insultes légères", durationSeconds: 15 * 60 },
  { name: "Insultes graves", durationSeconds: 30 * 60 },
  { name: "Discrimination", durationSeconds: 60 * 60 },
]);

export const MIN_SANCTION_SECONDS = 60;
export const MAX_SANCTION_SECONDS = 28 * 86_400; // limite Discord des exclusions temporaires

/** "10m", "1h30", "2j", "45" (minutes) → secondes ; null si invalide. */
export function parseDurationToSeconds(input) {
  const text = String(input ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 60;
  const re = /(\d+)(j|d|h|m|min|s)/g;
  let total = 0;
  let consumed = "";
  for (const match of text.matchAll(re)) {
    const value = Number(match[1]);
    total += match[2] === "j" || match[2] === "d" ? value * 86_400 : match[2] === "h" ? value * 3_600 : match[2] === "s" ? value : value * 60;
    consumed += match[0];
  }
  // "1h30" : minutes implicites après des heures.
  const trailing = /h(\d+)$/.exec(text);
  if (trailing && consumed + trailing[1] === text) { total += Number(trailing[1]) * 60; consumed = text; }
  return consumed === text && total > 0 ? total : null;
}

function rowToType(row) {
  return { id: String(row.id), name: row.name, durationSeconds: Number(row.duration_seconds) };
}

/** Insert the 4 default types the first time a guild is seen (once, even after deletions). */
export async function ensureDefaultSanctionTypes(guildId) {
  await sharedTransaction(async (client) => {
    const { rowCount } = await client.query(
      "INSERT INTO guild_bootstrap(guild_id, key) VALUES ($1, 'sanction_types') ON CONFLICT DO NOTHING",
      [guildId],
    );
    if (!rowCount) return;
    for (const type of DEFAULT_SANCTION_TYPES) {
      await client.query(
        "INSERT INTO sanction_types(guild_id, name, duration_seconds, created_by) VALUES ($1, $2, $3, 'défaut') ON CONFLICT DO NOTHING",
        [guildId, type.name, type.durationSeconds],
      );
    }
  });
}

export async function listSanctionTypes(guildId) {
  await ensureDefaultSanctionTypes(guildId);
  const { rows } = await sharedQuery(
    "SELECT id, name, duration_seconds FROM sanction_types WHERE guild_id = $1 ORDER BY duration_seconds, name",
    [guildId],
  );
  return rows.map(rowToType);
}

export async function getSanctionType(guildId, id) {
  if (!/^\d{1,18}$/.test(String(id ?? ""))) return null;
  const { rows } = await sharedQuery("SELECT id, name, duration_seconds FROM sanction_types WHERE guild_id = $1 AND id = $2", [guildId, id]);
  return rows[0] ? rowToType(rows[0]) : null;
}

function validate(name, durationSeconds) {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 1 || clean.length > 80) throw new Error("Nom de sanction : 1 à 80 caractères.");
  if (!Number.isInteger(durationSeconds) || durationSeconds < MIN_SANCTION_SECONDS || durationSeconds > MAX_SANCTION_SECONDS) {
    throw new Error("Durée invalide : entre 1 minute et 28 jours.");
  }
  return clean;
}

async function logChange(client, { guildId, actorId, bot, key, before, after }) {
  await client.query(
    "INSERT INTO config_changes(guild_id, actor_id, bot, entity, entity_key, before, after) VALUES ($1, $2, $3, 'sanction_type', $4, $5, $6)",
    [guildId, actorId, bot, key, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}

function uniqueViolation(error) {
  return error?.code === "23505";
}

export async function addSanctionType({ guildId, name, durationSeconds, actorId, bot }) {
  await ensureDefaultSanctionTypes(guildId);
  const clean = validate(name, durationSeconds);
  try {
    return await sharedTransaction(async (client) => {
      const { rows } = await client.query(
        "INSERT INTO sanction_types(guild_id, name, duration_seconds, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, duration_seconds",
        [guildId, clean, durationSeconds, actorId],
      );
      const created = rowToType(rows[0]);
      await logChange(client, { guildId, actorId, bot, key: created.id, before: null, after: { name: created.name, durationSeconds } });
      return created;
    });
  } catch (error) {
    if (uniqueViolation(error)) throw new Error(`Une sanction « ${clean} » existe déjà.`);
    throw error;
  }
}

export async function updateSanctionType({ guildId, id, name = null, durationSeconds = null, actorId, bot }) {
  try {
    return await sharedTransaction(async (client) => {
      const { rows } = await client.query("SELECT id, name, duration_seconds FROM sanction_types WHERE guild_id = $1 AND id = $2 FOR UPDATE", [guildId, id]);
      if (!rows[0]) throw new Error("Sanction introuvable.");
      const before = rowToType(rows[0]);
      const nextName = validate(name ?? before.name, durationSeconds ?? before.durationSeconds);
      const nextDuration = durationSeconds ?? before.durationSeconds;
      await client.query("UPDATE sanction_types SET name = $3, duration_seconds = $4, updated_at = now() WHERE guild_id = $1 AND id = $2", [guildId, id, nextName, nextDuration]);
      const after = { id: before.id, name: nextName, durationSeconds: nextDuration };
      await logChange(client, { guildId, actorId, bot, key: before.id, before: { name: before.name, durationSeconds: before.durationSeconds }, after: { name: nextName, durationSeconds: nextDuration } });
      return { before, after };
    });
  } catch (error) {
    if (uniqueViolation(error)) throw new Error(`Une sanction « ${name} » existe déjà.`);
    throw error;
  }
}

export async function deleteSanctionType({ guildId, id, actorId, bot }) {
  return sharedTransaction(async (client) => {
    const { rows } = await client.query("DELETE FROM sanction_types WHERE guild_id = $1 AND id = $2 RETURNING id, name, duration_seconds", [guildId, id]);
    if (!rows[0]) throw new Error("Sanction introuvable.");
    const deleted = rowToType(rows[0]);
    await logChange(client, { guildId, actorId, bot, key: deleted.id, before: { name: deleted.name, durationSeconds: deleted.durationSeconds }, after: null });
    return deleted;
  });
}

/** Full sanction history of one member (most recent first, paged). */
export async function listMemberSanctions(guildId, targetId, { limit = 25, offset = 0 } = {}) {
  const [{ rows }, count] = await Promise.all([
    sharedQuery(
      `SELECT id, moderator_id, action, sanction_label, reason, duration_seconds, bot, created_at
       FROM sanctions WHERE guild_id = $1 AND target_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [guildId, targetId, Math.min(100, Math.max(1, limit)), Math.max(0, offset)],
    ),
    sharedQuery("SELECT COUNT(*)::int AS n FROM sanctions WHERE guild_id = $1 AND target_id = $2", [guildId, targetId]),
  ]);
  return {
    total: Number(count.rows[0]?.n ?? 0),
    items: rows.map((row) => ({
      id: String(row.id), moderatorId: row.moderator_id, action: row.action, label: row.sanction_label,
      reason: row.reason, durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      bot: row.bot, createdAt: new Date(row.created_at),
    })),
  };
}
