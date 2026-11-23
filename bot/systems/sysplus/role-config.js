import { db } from "../../database.js";

export function getAdminPlusRoleId(guildId) {
  if (!guildId) return null;
  return db.prepare("SELECT admin_plus_role_id FROM guild_permission_roles WHERE guild_id=?").get(guildId)?.admin_plus_role_id ?? null;
}

export function setAdminPlusRoleId(guildId, roleId, actorId) {
  if (!guildId || !roleId || !actorId) throw new Error("Configuration ADMIN+ incomplète.");
  db.prepare(`INSERT INTO guild_permission_roles(guild_id,admin_plus_role_id,updated_by,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET
    admin_plus_role_id=excluded.admin_plus_role_id, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(guildId, roleId, actorId, Date.now());
  return roleId;
}
