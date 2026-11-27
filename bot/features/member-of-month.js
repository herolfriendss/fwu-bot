// SUCK ME + LE FISC — membre du mois (/membredumois, =membredumois).
//   Chaque membre vote une fois par mois (heure de Paris) pour quelqu'un d'autre, vote modifiable.
//   Le 1er du mois, le plus voté du mois passé (3 votes au moins) reçoit le rôle choisi pour 30 jours
//   et une prime en PND ; l'annonce part dans le salon choisi. Égalité : celui qui a atteint son score en premier.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { grantPnd } from "../economy.js";
import { roleGrantRefusal } from "../role-grant-guard.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const MOTM_COMMANDS = new Set(["membredumois"]);
export const MOTM = Object.freeze({ minVotes: 3, roleDays: 30, defaultReward: 2_000, maxReward: 100_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS motm_config (guild_id TEXT PRIMARY KEY, role_id TEXT, channel_id TEXT, reward INTEGER NOT NULL DEFAULT 2000);
  CREATE TABLE IF NOT EXISTS motm_votes (guild_id TEXT NOT NULL, month TEXT NOT NULL, voter_id TEXT NOT NULL, candidate_id TEXT NOT NULL, voted_at INTEGER NOT NULL, PRIMARY KEY (guild_id, month, voter_id));
  CREATE TABLE IF NOT EXISTS motm_winners (guild_id TEXT NOT NULL, month TEXT NOT NULL, user_id TEXT, votes INTEGER NOT NULL DEFAULT 0, role_id TEXT, expires_at INTEGER, role_removed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, month));
`);

/** "2026-11" (heure de Paris). */
export function monthKey(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

export function previousMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const monthLabel = (key) => `${MONTHS[Number(key.split("-")[1]) - 1]} ${key.split("-")[0]}`;

export function motmConfig(guildId) {
  const row = db.prepare("SELECT * FROM motm_config WHERE guild_id=?").get(guildId);
  return { roleId: row?.role_id ?? null, channelId: row?.channel_id ?? null, reward: row?.reward ?? MOTM.defaultReward };
}

export function configureMotm(guildId, { roleId, channelId, reward }) {
  if (reward != null && !(Number.isSafeInteger(reward) && reward >= 0 && reward <= MOTM.maxReward)) throw new Error(`Prime : 0 à ${MOTM.maxReward.toLocaleString("fr-FR")} PND.`);
  const next = { ...motmConfig(guildId), ...(roleId ? { roleId } : {}), ...(channelId ? { channelId } : {}), ...(reward != null ? { reward } : {}) };
  db.prepare(`INSERT INTO motm_config(guild_id,role_id,channel_id,reward) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET role_id=excluded.role_id, channel_id=excluded.channel_id, reward=excluded.reward`)
    .run(guildId, next.roleId, next.channelId, next.reward);
  return next;
}

export function castVote({ guildId, voterId, candidateId, candidateIsBot = false }, now = Date.now()) {
  if (voterId === candidateId) throw new Error("Tu ne peux pas voter pour toi.");
  if (candidateIsBot) throw new Error("Pas de vote pour un bot.");
  const month = monthKey(now);
  const before = db.prepare("SELECT candidate_id FROM motm_votes WHERE guild_id=? AND month=? AND voter_id=?").get(guildId, month, voterId);
  db.prepare(`INSERT INTO motm_votes(guild_id,month,voter_id,candidate_id,voted_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,month,voter_id) DO UPDATE SET candidate_id=excluded.candidate_id, voted_at=excluded.voted_at`).run(guildId, month, voterId, candidateId, now);
  return { month, changed: Boolean(before && before.candidate_id !== candidateId) };
}

/** Classement d'un mois : plus de votes d'abord, égalité → score atteint le plus tôt. */
export function tally(guildId, month) {
  return db.prepare(`SELECT candidate_id, COUNT(*) AS votes, MAX(voted_at) AS reached FROM motm_votes WHERE guild_id=? AND month=?
    GROUP BY candidate_id ORDER BY votes DESC, reached ASC`).all(guildId, month).map((r) => ({ userId: r.candidate_id, votes: Number(r.votes) }));
}

/**
 * Passage planifié : clôture le mois passé (une fois), donne rôle et prime, retire les rôles expirés.
 * `announce(guild, channelId, text)` publie le résultat.
 */
export async function runMemberOfMonth(client, { isAllowedGuild = () => true, now = Date.now(), announce = async () => {} } = {}) {
  const closing = previousMonth(monthKey(now));
  const guildIds = db.prepare("SELECT guild_id FROM motm_config").all().map((r) => r.guild_id);
  for (const guildId of guildIds) {
    const guild = isAllowedGuild(guildId) ? client.guilds.cache.get(guildId) : null;
    if (!guild) continue;
    for (const expired of db.prepare("SELECT * FROM motm_winners WHERE guild_id=? AND role_removed=0 AND expires_at IS NOT NULL AND expires_at<=?").all(guildId, now)) {
      const member = await guild.members.fetch(expired.user_id).catch(() => null);
      if (member && expired.role_id) await member.roles.remove(expired.role_id, "Fin du titre de membre du mois").catch(() => {});
      db.prepare("UPDATE motm_winners SET role_removed=1 WHERE guild_id=? AND month=?").run(guildId, expired.month);
    }
    if (db.prepare("SELECT 1 FROM motm_winners WHERE guild_id=? AND month=?").get(guildId, closing)) continue;
    const config = motmConfig(guildId);
    const ranking = [];
    for (const row of tally(guildId, closing)) {
      if (row.votes < MOTM.minVotes) break;
      if (await guild.members.fetch(row.userId).catch(() => null)) { ranking.push(row); break; }
    }
    const winner = ranking[0] ?? null;
    let roleGiven = false;
    if (winner && config.roleId) {
      const role = guild.roles.cache.get(config.roleId) ?? await guild.roles.fetch(config.roleId).catch(() => null);
      const refused = role ? await roleGrantRefusal(guild, role, { automatic: true, targetId: winner.userId }) : "Rôle introuvable.";
      if (!refused) roleGiven = await guild.members.fetch(winner.userId).then((m) => m.roles.add(role.id, `Membre du mois (${monthLabel(closing)})`)).then(() => true).catch(() => false);
    }
    if (winner && config.reward) { try { grantPnd(guildId, winner.userId, config.reward, "motm_reward"); } catch { /* compte économie indisponible */ } }
    db.prepare("INSERT INTO motm_winners(guild_id,month,user_id,votes,role_id,expires_at,role_removed) VALUES(?,?,?,?,?,?,?)")
      .run(guildId, closing, winner?.userId ?? null, winner?.votes ?? 0, roleGiven ? config.roleId : null, roleGiven ? now + MOTM.roleDays * 86_400_000 : null, roleGiven ? 0 : 1);
    if (winner && config.channelId) {
      await announce(guild, config.channelId, `🏆 **Membre du mois de ${monthLabel(closing)}** : <@${winner.userId}> avec **${winner.votes} votes** !${roleGiven ? ` Rôle <@&${config.roleId}> pour ${MOTM.roleDays} jours.` : ""}${config.reward ? ` Prime : **${config.reward.toLocaleString("fr-FR")} PND**.` : ""}\nLes votes de ce mois sont ouverts : \`/membredumois voter\`.`, winner.userId).catch(() => {});
    }
  }
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleMemberOfMonthInteraction(interaction, now = Date.now()) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "membredumois" || !interaction.guild) return false;
  const gid = interaction.guild.id;
  const o = interaction.options;
  const sub = o.getSubcommand(false) ?? "classement";
  try {
    if (sub === "voter") {
      const target = o.getUser("membre", true);
      const { month, changed } = castVote({ guildId: gid, voterId: interaction.user.id, candidateId: target.id, candidateIsBot: target.bot }, now);
      await interaction.reply({ content: `🗳️ ${changed ? "Vote changé" : "Vote enregistré"} pour <@${target.id}> (membre du mois de ${monthLabel(month)}). Résultat le 1er du mois prochain.`, ephemeral: true, allowedMentions: { parse: [] } });
    } else if (sub === "configurer") {
      if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
      const config = configureMotm(gid, { roleId: o.getRole("role", false)?.id, channelId: o.getChannel("salon", false)?.id, reward: o.getInteger("prime", false) });
      await interaction.reply({ content: `🏆 Membre du mois : rôle ${config.roleId ? `<@&${config.roleId}>` : "aucun"} (${MOTM.roleDays} jours), annonce ${config.channelId ? `dans <#${config.channelId}>` : "nulle part"}, prime ${config.reward.toLocaleString("fr-FR")} PND. ${MOTM.minVotes} votes au moins pour gagner.`, ephemeral: true, allowedMentions: { parse: [] } });
    } else {
      const month = monthKey(now);
      const rows = tally(gid, month).slice(0, 10);
      await interaction.reply({ content: rows.length ? `🏆 **Membre du mois de ${monthLabel(month)}** (en cours)\n${rows.map((r, i) => `${i + 1}. <@${r.userId}> · ${r.votes} vote${r.votes > 1 ? "s" : ""}`).join("\n")}` : `Aucun vote pour ${monthLabel(month)} : \`/membredumois voter\`.`, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
