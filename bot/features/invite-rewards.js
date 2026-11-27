// Récompenses d'invitation : SUCK ME affiche (/invitations), LE FISC paie (tâche horaire).
//   Un membre invité qui est toujours là 7 jours après son arrivée rapporte 250 PND à celui qui l'a invité.
//   Anti faux comptes : compte Discord d'au moins 14 jours à l'arrivée, jamais de bot, jamais soi-même,
//   une seule récompense par invité (revenir ne rapporte rien), 10 récompenses au plus par semaine et par membre.
//   L'invitation est connue par le suivi des invitations déjà en place (bot principal, à l'arrivée).
import { db } from "../database.js";
import { grantPnd } from "../economy.js";

export const INVITE_COMMANDS = new Set(["invitations"]);
export const INVITE_REWARD = Object.freeze({ amount: 250, stayMs: 7 * 86_400_000, minAccountAgeMs: 14 * 86_400_000, weeklyCap: 10, lookbackMs: 8 * 86_400_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS member_invite_attribution (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, source TEXT NOT NULL, inviter_id TEXT, code TEXT,
    joined_at INTEGER NOT NULL, PRIMARY KEY(guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invite_rewards (
    guild_id TEXT NOT NULL, invitee_id TEXT NOT NULL, inviter_id TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
    amount INTEGER NOT NULL DEFAULT 0, decided_at INTEGER NOT NULL, PRIMARY KEY (guild_id, invitee_id)
  );
  CREATE INDEX IF NOT EXISTS invite_rewards_inviter_idx ON invite_rewards(guild_id, inviter_id, status, decided_at);
`);

/** Invitations arrivées à 7 jours et pas encore décidées (seulement les arrivées récentes : pas de rattrapage du passé). */
export function dueInvites(now = Date.now()) {
  return db.prepare(`SELECT a.guild_id, a.user_id, a.inviter_id, a.joined_at FROM member_invite_attribution a
    LEFT JOIN invite_rewards r ON r.guild_id = a.guild_id AND r.invitee_id = a.user_id
    WHERE r.invitee_id IS NULL AND a.source = 'invite' AND a.inviter_id IS NOT NULL
      AND a.joined_at <= ? AND a.joined_at >= ? ORDER BY a.joined_at`).all(now - INVITE_REWARD.stayMs, now - INVITE_REWARD.lookbackMs);
}

function paidThisWeek(guildId, inviterId, now) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM invite_rewards WHERE guild_id=? AND inviter_id=? AND status='paid' AND decided_at>=?").get(guildId, inviterId, now - 7 * 86_400_000).n);
}

/**
 * Décision pure pour une invitation arrivée à échéance. `invitee` : { present, bot, createdTimestamp } ;
 * `inviterPresent` : l'inviteur est encore sur le serveur. Rend { status: "paid"|"rejected", reason }.
 */
export function decideInvite(row, { invitee, inviterPresent, paidRecently }) {
  if (row.inviter_id === row.user_id) return { status: "rejected", reason: "soi-même" };
  if (!invitee?.present) return { status: "rejected", reason: "parti avant 7 jours" };
  if (invitee.bot) return { status: "rejected", reason: "bot" };
  if (!invitee.createdTimestamp || Number(row.joined_at) - invitee.createdTimestamp < INVITE_REWARD.minAccountAgeMs) return { status: "rejected", reason: "compte trop récent" };
  if (!inviterPresent) return { status: "rejected", reason: "inviteur parti" };
  if (paidRecently >= INVITE_REWARD.weeklyCap) return { status: "rejected", reason: "plafond hebdomadaire" };
  return { status: "paid", reason: null };
}

export function recordDecision(row, decision, now = Date.now(), grant = grantPnd) {
  const amount = decision.status === "paid" ? INVITE_REWARD.amount : 0;
  const inserted = db.prepare("INSERT OR IGNORE INTO invite_rewards(guild_id,invitee_id,inviter_id,status,reason,amount,decided_at) VALUES(?,?,?,?,?,?,?)")
    .run(row.guild_id, row.user_id, row.inviter_id, decision.status, decision.reason, amount, now);
  if (!Number(inserted.changes)) return false;
  if (amount) {
    try { grant(row.guild_id, row.inviter_id, amount, "invite_reward"); }
    catch { db.prepare("UPDATE invite_rewards SET status='rejected', reason='économie indisponible', amount=0 WHERE guild_id=? AND invitee_id=?").run(row.guild_id, row.user_id); return false; }
  }
  return true;
}

/** Tâche horaire (LE FISC). Rend le nombre de récompenses versées. */
export async function runInviteRewards(client, { isAllowedGuild = () => true, now = Date.now() } = {}) {
  let paid = 0;
  for (const row of dueInvites(now)) {
    const guild = isAllowedGuild(row.guild_id) ? client.guilds.cache.get(row.guild_id) : null;
    if (!guild) continue;
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    const user = member?.user ?? await client.users.fetch(row.user_id).catch(() => null);
    const inviter = await guild.members.fetch(row.inviter_id).catch(() => null);
    const decision = decideInvite(row, {
      invitee: { present: Boolean(member), bot: Boolean(user?.bot), createdTimestamp: user?.createdTimestamp ?? null },
      inviterPresent: Boolean(inviter),
      paidRecently: paidThisWeek(row.guild_id, row.inviter_id, now),
    });
    if (recordDecision(row, decision, now) && decision.status === "paid") paid += 1;
  }
  return paid;
}

export function inviteLeaderboard(guildId, limit = 10) {
  return db.prepare(`SELECT inviter_id, COUNT(*) AS n, SUM(amount) AS earned FROM invite_rewards WHERE guild_id=? AND status='paid'
    GROUP BY inviter_id ORDER BY n DESC, earned DESC LIMIT ?`).all(guildId, limit).map((r) => ({ inviterId: r.inviter_id, count: Number(r.n), earned: Number(r.earned) }));
}

export function inviteStats(guildId, inviterId, now = Date.now()) {
  const decided = db.prepare("SELECT status, COUNT(*) AS n, SUM(amount) AS earned FROM invite_rewards WHERE guild_id=? AND inviter_id=? GROUP BY status").all(guildId, inviterId);
  const pending = Number(db.prepare(`SELECT COUNT(*) AS n FROM member_invite_attribution a LEFT JOIN invite_rewards r ON r.guild_id=a.guild_id AND r.invitee_id=a.user_id
    WHERE a.guild_id=? AND a.inviter_id=? AND a.source='invite' AND r.invitee_id IS NULL AND a.joined_at > ?`).get(guildId, inviterId, now - INVITE_REWARD.stayMs).n);
  const paid = decided.find((d) => d.status === "paid");
  const rejected = decided.find((d) => d.status === "rejected");
  return { paid: Number(paid?.n ?? 0), earned: Number(paid?.earned ?? 0), rejected: Number(rejected?.n ?? 0), pending };
}

const medal = (i) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;

export async function handleInviteRewardsInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "invitations" || !interaction.guild) return false;
  const sub = interaction.options.getSubcommand(false) ?? "moi";
  const gid = interaction.guild.id;
  let content;
  if (sub === "classement") {
    const rows = inviteLeaderboard(gid);
    content = rows.length
      ? `📨 **Classement des invitations** (invités restés 7 jours)\n${rows.map((r, i) => `${medal(i)} <@${r.inviterId}> · **${r.count}** invité(s) · ${r.earned.toLocaleString("fr-FR")} PND`).join("\n")}`
      : "Aucune invitation récompensée pour l'instant.";
  } else {
    const target = interaction.options.getUser("membre", false) ?? interaction.user;
    const s = inviteStats(gid, target.id);
    content = [
      `📨 **Invitations de <@${target.id}>**`,
      `Récompensées : **${s.paid}** (${s.earned.toLocaleString("fr-FR")} PND) · en attente des 7 jours : **${s.pending}** · non retenues : ${s.rejected}`,
      `Chaque invité resté 7 jours rapporte **${INVITE_REWARD.amount} PND** (compte de 14 jours minimum, une fois par invité, ${INVITE_REWARD.weeklyCap} par semaine au plus).`,
    ].join("\n");
  }
  await interaction.reply({ content, ephemeral: sub !== "classement", allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
