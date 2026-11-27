// SYS+ — SYS+ temporaire et période d'essai (options de /sysp add).
//   /sysp add membre duree:7j  → le rôle SYS+ est retiré tout seul à la fin (1 h à 90 jours).
//   /sysp add membre essai:true → période d'essai de 14 jours : 2 jours avant la fin, l'owner reçoit une alerte avec
//   un bouton « Confirmer » ; sans confirmation, le rôle est retiré à l'échéance. Le retrait automatique ne donne
//   jamais de droit : seul le sens « moins de privilèges » est automatique. Tout est journalisé dans l'audit SYS+.
import { db } from "../../database.js";
import { parseDurationToSeconds } from "../../shared/sanctions.js";
import { recordSysPlusAudit } from "./audit.js";
import { canConfigureSysPlus } from "./permissions.js";

export const TEMP_SYSPLUS = Object.freeze({ minSeconds: 3_600, maxSeconds: 90 * 86_400, trialDays: 14, warnMs: 2 * 86_400_000 });

db.exec(`CREATE TABLE IF NOT EXISTS sysplus_temporary (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, kind TEXT NOT NULL, granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, warned INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (guild_id, user_id)
)`);

/** Durée demandée → secondes, ou erreur claire. `essai` impose 14 jours. */
export function sysPlusSpan({ duree = null, essai = false }) {
  if (essai && duree) throw new Error("Choisis une durée ou la période d'essai, pas les deux.");
  if (essai) return { seconds: TEMP_SYSPLUS.trialDays * 86_400, kind: "trial" };
  if (!duree) return null;
  const seconds = parseDurationToSeconds(duree);
  if (!seconds || seconds < TEMP_SYSPLUS.minSeconds || seconds > TEMP_SYSPLUS.maxSeconds) throw new Error("Durée : de 1 h à 90 jours (ex. 12h, 7j).");
  return { seconds, kind: "temporary" };
}

export function trackTemporary({ guildId, userId, roleId, grantedBy, seconds, kind }, now = Date.now()) {
  db.prepare(`INSERT OR REPLACE INTO sysplus_temporary(guild_id,user_id,role_id,kind,granted_by,created_at,expires_at,warned,status) VALUES(?,?,?,?,?,?,?,0,'active')`)
    .run(guildId, userId, roleId, kind, grantedBy, now, now + seconds * 1000);
}

/** Le SYS+ est retiré à la main : plus rien à surveiller. */
export function forgetTemporary(guildId, userId) {
  db.prepare("UPDATE sysplus_temporary SET status='removed' WHERE guild_id=? AND user_id=? AND status='active'").run(guildId, userId);
}

export function temporaryOf(guildId, userId) {
  return db.prepare("SELECT * FROM sysplus_temporary WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? null;
}

export const confirmButtons = (guildId, userId) => [{ type: 1, components: [{ type: 2, style: 3, label: "Confirmer SYS+", emoji: { name: "✅" }, custom_id: `sysptrial:confirm:${guildId}:${userId}` }] }];

/**
 * Passage (toutes les 5 min) : alerte de fin d'essai, retrait des SYS+ échus.
 * `notify(guild, title, text, components)` écrit dans les logs staff.
 */
export async function runTemporarySysPlus(client, { isAllowedGuild = () => true, now = Date.now(), notify = async () => {} } = {}) {
  const out = { warned: 0, removed: 0 };
  for (const row of db.prepare("SELECT * FROM sysplus_temporary WHERE status='active'").all()) {
    const guild = isAllowedGuild(row.guild_id) ? client.guilds.cache.get(row.guild_id) : null;
    if (!guild) continue;
    if (row.expires_at <= now) {
      db.prepare("UPDATE sysplus_temporary SET status='expired' WHERE guild_id=? AND user_id=? AND status='active'").run(row.guild_id, row.user_id);
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      if (member?.roles?.cache?.has(row.role_id)) await member.roles.remove(row.role_id, row.kind === "trial" ? "Fin de la période d'essai SYS+" : "Fin du SYS+ temporaire").catch(() => {});
      try { recordSysPlusAudit(row.guild_id, client.user?.id ?? "bot", "sysplus.member.expire", row.user_id, { kind: row.kind }); } catch { /* journal best effort */ }
      await notify(guild, "SYS+ — fin automatique", `<@${row.user_id}> n'a plus SYS+ (${row.kind === "trial" ? "période d'essai terminée sans confirmation" : "durée écoulée"}).`).catch(() => {});
      out.removed += 1;
    } else if (row.kind === "trial" && !row.warned && row.expires_at - now <= TEMP_SYSPLUS.warnMs) {
      db.prepare("UPDATE sysplus_temporary SET warned=1 WHERE guild_id=? AND user_id=?").run(row.guild_id, row.user_id);
      await notify(guild, "SYS+ — fin de période d'essai", `L'essai SYS+ de <@${row.user_id}> se termine <t:${Math.floor(row.expires_at / 1000)}:R>. Sans confirmation de l'owner, le rôle sera retiré.`, confirmButtons(row.guild_id, row.user_id)).catch(() => {});
      out.warned += 1;
    }
  }
  return out;
}

/** Bouton « Confirmer SYS+ » : owner seulement ; le SYS+ devient définitif. */
export async function handleTrialConfirm(interaction, { client, now = Date.now() } = {}) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith("sysptrial:confirm:")) return false;
  const [, , guildId, userId] = interaction.customId.split(":");
  const guild = client?.guilds?.cache?.get?.(guildId);
  const clicker = guild ? await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null) : null;
  if (!clicker || !canConfigureSysPlus(clicker)) {
    await interaction.reply({ content: "⛔ Seul le Owner PND confirme un SYS+ à l'essai.", ephemeral: true }).catch(() => {});
    return true;
  }
  const done = db.prepare("UPDATE sysplus_temporary SET status='confirmed' WHERE guild_id=? AND user_id=? AND kind='trial' AND status='active' AND expires_at>?").run(guildId, userId, now);
  if (!Number(done.changes)) {
    await interaction.reply({ content: "Cet essai est déjà terminé, confirmé ou retiré.", ephemeral: true }).catch(() => {});
    return true;
  }
  try { recordSysPlusAudit(guildId, clicker.id, "sysplus.member.confirm", userId, { kind: "trial" }); } catch { /* journal best effort */ }
  await interaction.update({ content: `✅ <@${userId}> garde SYS+ : essai confirmé par <@${clicker.id}>.`, embeds: [], components: [], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
