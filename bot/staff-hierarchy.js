import { db } from "./database.js";
import { isDiscordSnowflake, staffSupervisorAssignmentDecision } from "./staff-hierarchy-policy.js";

const relationSelect = db.prepare(
  "SELECT guild_id,staff_user_id,supervisor_user_id,updated_by,updated_at FROM staff_supervisors WHERE guild_id=? AND staff_user_id=?",
);
const relationList = db.prepare(
  "SELECT guild_id,staff_user_id,supervisor_user_id,updated_by,updated_at FROM staff_supervisors WHERE guild_id=? ORDER BY updated_at DESC, staff_user_id ASC",
);
const relationUpsert = db.prepare(`
  INSERT INTO staff_supervisors(guild_id,staff_user_id,supervisor_user_id,updated_by,updated_at)
  VALUES(?,?,?,?,?)
  ON CONFLICT(guild_id,staff_user_id) DO UPDATE SET
    supervisor_user_id=excluded.supervisor_user_id,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at
`);

function toRelation(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    staffUserId: row.staff_user_id,
    supervisorUserId: row.supervisor_user_id,
    updatedBy: row.updated_by,
    updatedAt: Number(row.updated_at),
  };
}

export function getStaffSupervisor(guildId, staffUserId) {
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(staffUserId)) return null;
  return toRelation(relationSelect.get(guildId, staffUserId));
}

export function getStaffSupervisorId(guildId, staffUserId) {
  return getStaffSupervisor(guildId, staffUserId)?.supervisorUserId ?? null;
}

export function listStaffSupervisors(guildId) {
  if (!isDiscordSnowflake(guildId)) return [];
  return relationList.all(guildId).map(toRelation);
}

export function setStaffSupervisor({
  guildId,
  staffUserId,
  supervisorUserId,
  updatedBy,
  guildOwnerId = null,
  now = Date.now(),
}) {
  if (!isDiscordSnowflake(updatedBy)) throw new Error("Auteur de configuration invalide.");
  const existingRelations = db.prepare(
    "SELECT staff_user_id,supervisor_user_id FROM staff_supervisors WHERE guild_id=?",
  ).all(guildId);
  const decision = staffSupervisorAssignmentDecision({
    guildId, staffUserId, supervisorUserId, guildOwnerId, existingRelations,
  });
  if (!decision.allowed) throw new Error(decision.reason);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Horodatage invalide.");
  relationUpsert.run(guildId, staffUserId, supervisorUserId, updatedBy, now);
  return getStaffSupervisor(guildId, staffUserId);
}

export function removeStaffSupervisor({ guildId, staffUserId }) {
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(staffUserId)) {
    throw new Error("Serveur ou membre invalide.");
  }
  const result = db.prepare(
    "DELETE FROM staff_supervisors WHERE guild_id=? AND staff_user_id=?",
  ).run(guildId, staffUserId);
  return Number(result.changes) > 0;
}
