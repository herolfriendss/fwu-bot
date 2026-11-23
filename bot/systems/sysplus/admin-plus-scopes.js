import { db } from "../../database.js";
import { ADMIN_PLUS_SCOPES } from "./admin-plus-scope-policy.js";
export { ADMIN_PLUS_SCOPES, canUseAdminPlusScope } from "./admin-plus-scope-policy.js";

const selectPermission = db.prepare(
  "SELECT enabled FROM admin_plus_scope_permissions WHERE guild_id=? AND scope=?",
);
const upsertPermission =
  db.prepare(`INSERT INTO admin_plus_scope_permissions(guild_id,scope,enabled,updated_by,updated_at)
  VALUES(?,?,?,?,?) ON CONFLICT(guild_id,scope) DO UPDATE SET
  enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`);

export function getAdminPlusScope(guildId, scope) {
  const definition = ADMIN_PLUS_SCOPES[scope];
  if (!guildId || !definition) return false;
  const row = selectPermission.get(guildId, scope);
  return row ? row.enabled === 1 : definition.defaultEnabled;
}

export function setAdminPlusScope(guildId, scope, enabled, actorId) {
  if (!guildId || !ADMIN_PLUS_SCOPES[scope] || typeof enabled !== "boolean" || !actorId) {
    throw new Error("Configuration de permission ADMIN+ invalide.");
  }
  upsertPermission.run(guildId, scope, enabled ? 1 : 0, actorId, Date.now());
  return enabled;
}
