// LE FISC — le 1er du mois, le membre le plus riche reçoit le rôle « Plus riche du mois »
// (aucune permission, retiré au précédent). Passe par role-grant-guard comme toute attribution.
import { db } from "../database.js";
import { assertRoleGrantable } from "../role-grant-guard.js";

export const RICHEST_ROLE_NAME = "Plus riche du mois";
db.exec("CREATE TABLE IF NOT EXISTS richest_month_awards (guild_id TEXT NOT NULL, month TEXT NOT NULL, user_id TEXT NOT NULL, balance INTEGER NOT NULL, PRIMARY KEY (guild_id, month))");

export const awardMonth = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

/** Pure: the richest member that is still on the server (bots excluded). */
export function pickRichest(rows, isEligible = () => true) {
  return rows.find((row) => Number(row.balance) > 0 && isEligible(row.user_id)) ?? null;
}

export async function awardRichestOfMonth(guild, { settings, now = Date.now() } = {}) {
  if (new Date(now).getUTCDate() !== 1) return null;
  const month = awardMonth(now);
  if (db.prepare("SELECT 1 FROM richest_month_awards WHERE guild_id=? AND month=?").get(guild.id, month)) return null;
  const rows = db.prepare("SELECT user_id, balance FROM wallets WHERE guild_id=? ORDER BY balance DESC LIMIT 20").all(guild.id);
  const members = await guild.members.fetch({ user: rows.map((r) => r.user_id) }).catch(() => null);
  const winner = pickRichest(rows, (id) => { const m = members?.get?.(id); return Boolean(m && !m.user.bot); });
  db.prepare("INSERT OR IGNORE INTO richest_month_awards VALUES (?,?,?,?)").run(guild.id, month, winner?.user_id ?? "-", winner?.balance ?? 0);
  if (!winner) return null;
  let role = guild.roles.cache.find((r) => r.name === RICHEST_ROLE_NAME && !r.managed);
  role ??= await guild.roles.create({ name: RICHEST_ROLE_NAME, color: 0xfacc15, hoist: true, permissions: [], reason: "Classement mensuel des fortunes" });
  await assertRoleGrantable(guild, role, { automatic: true, settings, targetId: winner.user_id });
  for (const holder of role.members?.values?.() ?? []) if (holder.id !== winner.user_id) await holder.roles.remove(role, "Nouveau plus riche du mois").catch(() => {});
  const member = members.get(winner.user_id);
  await member.roles.add(role, "Plus riche du mois");
  await guild.systemChannel?.send?.({ content: `💰 **Plus riche du mois** : <@${winner.user_id}> avec ${Number(winner.balance).toLocaleString("fr-FR")} PND ! Le rôle est à lui jusqu'au mois prochain.`, allowedMentions: { users: [winner.user_id] } }).catch(() => {});
  return winner;
}
