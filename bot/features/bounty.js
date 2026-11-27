// LE FISC — prime sur un membre (/prime, -prime par le pont préfixe).
//   /prime poser membre montant : l'argent est bloqué tout de suite (pris sur ton portefeuille).
//   Plusieurs primes sur la même tête s'additionnent. Celui qui bat la cible en duel (mise de
//   100 PND au moins) ou réussit à la voler empoche tout. Sans preneur en 7 jours, chacun est remboursé.
//   Garde-fous : pas sur soi-même ni un bot, on ne touche pas une prime qu'on a posée, 100 à 50 000 PND.
// Pas d'import de economy.js (il appelle claimBounty) : mouvements écrits ici, journalisés pareil.
import { db, transaction } from "../database.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const BOUNTY_COMMANDS = new Set(["prime"]);
export const BOUNTY = Object.freeze({ min: 100, max: 50_000, ttlMs: 7 * 86_400_000, minDuelBet: 100 });

db.exec(`
  CREATE TABLE IF NOT EXISTS fisc_bounties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, target_id TEXT NOT NULL, poster_id TEXT NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', claimed_by TEXT, claimed_via TEXT,
    created_at INTEGER NOT NULL, closed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS fisc_bounties_target_idx ON fisc_bounties(guild_id, target_id, status);
`);

const fmt = (n) => `${Number(n).toLocaleString("fr-FR")} PND`;

function moveWallet(guildId, userId, delta, reason, now) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const result = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance+?>=0").run(delta, guildId, userId, delta);
  if (!Number(result.changes)) throw new Error("Solde PND insuffisant.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)").run(guildId, userId, delta, reason, now);
}

/** Rembourse les primes de plus de 7 jours. Rend le nombre de primes remboursées. */
export function expireBounties(now = Date.now(), guildId = null) {
  const rows = guildId
    ? db.prepare("SELECT * FROM fisc_bounties WHERE guild_id=? AND status='open' AND created_at<?").all(guildId, now - BOUNTY.ttlMs)
    : db.prepare("SELECT * FROM fisc_bounties WHERE status='open' AND created_at<?").all(now - BOUNTY.ttlMs);
  for (const row of rows) {
    transaction(() => {
      const done = db.prepare("UPDATE fisc_bounties SET status='expired', closed_at=? WHERE id=? AND status='open'").run(now, row.id);
      if (Number(done.changes)) moveWallet(row.guild_id, row.poster_id, row.amount, "bounty_refund", now);
    });
  }
  return rows.length;
}

export function bountyOn(guildId, targetId, now = Date.now()) {
  expireBounties(now, guildId);
  const rows = db.prepare("SELECT poster_id, amount, created_at FROM fisc_bounties WHERE guild_id=? AND target_id=? AND status='open' ORDER BY created_at").all(guildId, targetId);
  return { total: rows.reduce((sum, r) => sum + Number(r.amount), 0), posters: [...new Set(rows.map((r) => r.poster_id))], count: rows.length };
}

export function placeBounty({ guildId, posterId, targetId, amount, targetIsBot = false }, now = Date.now()) {
  if (posterId === targetId) throw new Error("Tu ne peux pas mettre une prime sur ta propre tête.");
  if (targetIsBot) throw new Error("Pas de prime sur un bot.");
  if (!Number.isSafeInteger(amount) || amount < BOUNTY.min || amount > BOUNTY.max) throw new Error(`Montant : de ${fmt(BOUNTY.min)} à ${fmt(BOUNTY.max)}.`);
  return transaction(() => {
    moveWallet(guildId, posterId, -amount, "bounty_posted", now);
    db.prepare("INSERT INTO fisc_bounties(guild_id,target_id,poster_id,amount,created_at) VALUES(?,?,?,?,?)").run(guildId, targetId, posterId, amount, now);
    return bountyOn(guildId, targetId, now);
  });
}

/**
 * Le chasseur bat la cible (duel ou vol réussi) : il empoche les primes ouvertes qu'il n'a pas posées.
 * À appeler dans la transaction du duel ou du vol. Rend le montant gagné (0 si rien).
 */
export function claimBounty(guildId, targetId, hunterId, via, now = Date.now()) {
  if (!targetId || !hunterId || targetId === hunterId) return 0;
  const rows = db.prepare("SELECT id, amount FROM fisc_bounties WHERE guild_id=? AND target_id=? AND status='open' AND poster_id<>? AND created_at>=?")
    .all(guildId, targetId, hunterId, now - BOUNTY.ttlMs);
  if (!rows.length) return 0;
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const close = db.prepare("UPDATE fisc_bounties SET status='claimed', claimed_by=?, claimed_via=?, closed_at=? WHERE id=? AND status='open'");
  let won = 0;
  for (const row of rows) if (Number(close.run(hunterId, via, now, row.id).changes)) won += Number(row.amount);
  if (won) moveWallet(guildId, hunterId, won, "bounty_claimed", now);
  return won;
}

export function openBounties(guildId, now = Date.now(), limit = 10) {
  expireBounties(now, guildId);
  return db.prepare("SELECT target_id, SUM(amount) AS total, COUNT(*) AS n FROM fisc_bounties WHERE guild_id=? AND status='open' GROUP BY target_id ORDER BY total DESC LIMIT ?")
    .all(guildId, limit).map((r) => ({ targetId: r.target_id, total: Number(r.total), count: Number(r.n) }));
}

export async function handleBountyInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "prime" || !interaction.guild) return false;
  const gid = interaction.guild.id;
  const sub = interaction.options.getSubcommand(false) ?? "liste";
  try {
    if (sub === "poser") {
      const target = interaction.options.getUser("membre", true);
      const amount = interaction.options.getInteger("montant", true);
      const state = placeBounty({ guildId: gid, posterId: interaction.user.id, targetId: target.id, amount, targetIsBot: target.bot });
      await interaction.reply({ content: `🎯 <@${interaction.user.id}> met **${fmt(amount)}** sur la tête de <@${target.id}> ! Prime totale : **${fmt(state.total)}**. Bats-le en duel (\`/duel\`, mise de ${fmt(BOUNTY.minDuelBet)} au moins) ou vole-le pour l'empocher. Remboursée dans 7 jours sans preneur.`, allowedMentions: { users: [target.id] } });
    } else if (sub === "voir") {
      const target = interaction.options.getUser("membre", false) ?? interaction.user;
      const state = bountyOn(gid, target.id);
      await interaction.reply({ content: state.total ? `🎯 Prime sur <@${target.id}> : **${fmt(state.total)}** (${state.count} prime(s)).` : `Aucune prime sur <@${target.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
    } else {
      const rows = openBounties(gid);
      await interaction.reply({ content: rows.length ? `🎯 **Avis de recherche**\n${rows.map((r, i) => `${i + 1}. <@${r.targetId}> · **${fmt(r.total)}**`).join("\n")}` : "Aucune prime en cours.", allowedMentions: { parse: [] } });
    }
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
