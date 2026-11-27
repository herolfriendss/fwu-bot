// SYS+ — double validation des attributions de SYS+ (idée 26). Quand elle est active (`/sysp double-validation`),
// `/sysp add` ne donne rien tout de suite : la demande attend l'accord d'un AUTRE membre SYS+ (24 h), puis le rôle est
// donné. Règle des deux personnes : celui qui demande ne peut pas valider sa propre demande. Un refus ou l'expiration
// n'accordent jamais rien. Tout est journalisé dans l'audit SYS+.
import { db } from "../../database.js";
import { recordSysPlusAudit } from "./audit.js";
import { isSysPlus } from "./permissions.js";
import { forgetTemporary, trackTemporary } from "./temporary.js";

export const DOUBLE_VALIDATION = Object.freeze({ ttlMs: 24 * 3_600_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS sysplus_double_validation (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sysplus_pending_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, requested_by TEXT NOT NULL,
    seconds INTEGER, kind TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT
  );
`);

export const doubleValidationEnabled = (guildId) => Boolean(db.prepare("SELECT enabled FROM sysplus_double_validation WHERE guild_id=?").get(guildId)?.enabled);

export function setDoubleValidation(guildId, enabled) {
  db.prepare("INSERT INTO sysplus_double_validation(guild_id,enabled) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled").run(guildId, enabled ? 1 : 0);
  return doubleValidationEnabled(guildId);
}

export function createPendingGrant({ guildId, userId, roleId, requestedBy, span = null }, now = Date.now()) {
  db.prepare("UPDATE sysplus_pending_grants SET status='replaced' WHERE guild_id=? AND user_id=? AND status='pending'").run(guildId, userId);
  const info = db.prepare("INSERT INTO sysplus_pending_grants(guild_id,user_id,role_id,requested_by,seconds,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(guildId, userId, roleId, requestedBy, span?.seconds ?? null, span?.kind ?? null, now, now + DOUBLE_VALIDATION.ttlMs);
  return Number(info.lastInsertRowid);
}

export const pendingButtons = (id) => [{ type: 1, components: [
  { type: 2, style: 3, label: "Valider", emoji: { name: "✅" }, custom_id: `sysp2:ok:${id}` },
  { type: 2, style: 4, label: "Refuser", emoji: { name: "✖️" }, custom_id: `sysp2:no:${id}` },
] }];

/** Décide une demande en attente, une seule fois. Rend la demande ou lève une erreur claire. */
export function decidePendingGrant(id, deciderId, approve, now = Date.now()) {
  const row = db.prepare("SELECT * FROM sysplus_pending_grants WHERE id=?").get(Number(id));
  if (!row || row.status !== "pending") throw new Error("Cette demande est déjà traitée ou n'existe plus.");
  if (row.expires_at <= now) {
    db.prepare("UPDATE sysplus_pending_grants SET status='expired' WHERE id=?").run(row.id);
    throw new Error("Cette demande a expiré (24 h).");
  }
  if (approve && row.requested_by === deciderId) throw new Error("Tu ne peux pas valider ta propre demande : il faut un autre membre SYS+.");
  const changed = db.prepare("UPDATE sysplus_pending_grants SET status=?, decided_by=? WHERE id=? AND status='pending'").run(approve ? "approved" : "refused", deciderId, row.id);
  if (!Number(changed.changes)) throw new Error("Cette demande est déjà traitée.");
  return row;
}

/** Boutons « Valider » / « Refuser » : réservés aux membres SYS+ (jamais le demandeur pour valider). */
export async function handleDoubleValidationButton(interaction, { client, roleIdOf = () => null, now = Date.now() } = {}) {
  const id = String(interaction?.customId ?? "");
  if (!interaction?.isButton?.() || !id.startsWith("sysp2:")) return false;
  const [, verdict, rawId] = id.split(":");
  const approve = verdict === "ok";
  const guild = interaction.guild ?? client?.guilds?.cache?.get?.(interaction.guildId);
  const reply = (content) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  const decider = guild ? await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null) : null;
  const roleId = roleIdOf(guild?.id);
  if (!decider || !isSysPlus(decider, roleId)) { await reply("⛔ Réservé aux membres SYS+."); return true; }
  let row;
  try { row = decidePendingGrant(rawId, decider.id, approve, now); }
  catch (error) { await reply(`❌ ${error.message}`); return true; }
  if (row.guild_id !== guild.id) { await reply("❌ Demande d'un autre serveur."); return true; }
  try { recordSysPlusAudit(guild.id, decider.id, approve ? "sysplus.member.approve" : "sysplus.member.refuse", row.user_id, { requestedBy: row.requested_by }); } catch { /* journal best effort */ }
  if (!approve) {
    await interaction.update({ content: `✖️ Demande de SYS+ pour <@${row.user_id}> refusée par <@${decider.id}>.`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
  const target = await guild.members.fetch({ user: row.user_id, force: true }).catch(() => null);
  try {
    if (!target) throw new Error("membre introuvable");
    if (!target.roles.cache.has(row.role_id)) await target.roles.add(row.role_id, `SYS+ attribué (double validation : ${row.requested_by} + ${decider.id})`);
    if (row.seconds) trackTemporary({ guildId: guild.id, userId: row.user_id, roleId: row.role_id, grantedBy: row.requested_by, seconds: row.seconds, kind: row.kind });
    else forgetTemporary(guild.id, row.user_id);
    try { recordSysPlusAudit(guild.id, row.requested_by, "sysplus.member.add", row.user_id, { roleId: row.role_id, validatedBy: decider.id }); } catch { /* journal best effort */ }
    await interaction.update({ content: `✅ SYS+ attribué à <@${row.user_id}> : demandé par <@${row.requested_by}>, validé par <@${decider.id}>.`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  } catch {
    await interaction.update({ content: `⚠️ Validée, mais le rôle n'a pas pu être donné à <@${row.user_id}> (permissions du bot ?). Refais la demande.`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
