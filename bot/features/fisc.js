// LE FISC — /impots (taxes + treasury), /pret (loans), /duel (bet between two members), /pari (scratch card, horse race).
import { randomInt } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { db, transaction } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { settleCasinoRound } from "../casino.js";
import { changeTreasury, getFiscConfig, saveFiscConfig, treasury } from "./fisc-config.js";
import { parisDate } from "./community.js";

export const FISC_COMMANDS = new Set(["impots", "pret", "duel", "pari"]);
const fmt = (n) => `${Number(n).toLocaleString("fr-FR")} PND`;
const isOwner = (member) => member?.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member?.id === member?.guild?.ownerId;
const isAdmin = (member) => isOwner(member) || Boolean(member?.permissions?.has?.(P.Administrator) || member?.permissions?.has?.(P.ManageGuild));

db.exec(`
  CREATE TABLE IF NOT EXISTS fisc_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, principal INTEGER NOT NULL,
    owed INTEGER NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', penalized INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fisc_loans_member_idx ON fisc_loans(guild_id, user_id, status);
  CREATE TABLE IF NOT EXISTS fisc_wealth_runs (guild_id TEXT NOT NULL, week TEXT NOT NULL, collected INTEGER NOT NULL, PRIMARY KEY (guild_id, week));
  CREATE TABLE IF NOT EXISTS fisc_duels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, challenger_id TEXT NOT NULL, opponent_id TEXT NOT NULL,
    bet INTEGER NOT NULL, game TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', winner_id TEXT, created_at INTEGER NOT NULL
  );
`);

function walletOf(guildId, userId) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const row = db.prepare("SELECT balance, bank FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return { balance: Number(row.balance), bank: Number(row.bank) };
}
function move(guildId, userId, delta, reason) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const result = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance+?>=0").run(delta, guildId, userId, delta);
  if (!Number(result.changes)) throw new Error("Solde PND insuffisant.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)").run(guildId, userId, delta, reason, Date.now());
}
/** Takes up to `amount` from wallet then bank; returns what was actually taken. */
function seize(guildId, userId, amount, reason) {
  const w = walletOf(guildId, userId);
  const fromWallet = Math.min(w.balance, amount);
  const fromBank = Math.min(w.bank, amount - fromWallet);
  if (fromWallet) move(guildId, userId, -fromWallet, reason);
  if (fromBank) {
    db.prepare("UPDATE wallets SET bank=bank-? WHERE guild_id=? AND user_id=?").run(fromBank, guildId, userId);
    db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)").run(guildId, userId, -fromBank, `${reason}_bank`, Date.now());
  }
  return fromWallet + fromBank;
}

// ---------------------------------------------------------------- Taxes
function fiscText(guildId) {
  const c = getFiscConfig(guildId);
  return [
    "🏛️ **Le Fisc**",
    `Impôt sur les transferts : **${c.transferRate} %** ${c.transferRate ? "(prélevé sur la somme reçue)" : "(désactivé)"}`,
    `Impôt sur la fortune : **${c.wealthRate} %** par semaine au-delà de **${fmt(c.wealthThreshold)}** ${c.wealthRate ? "(chaque lundi midi)" : "(désactivé)"}`,
    `Caisse du serveur : **${fmt(treasury(guildId))}**`,
  ].join("\n");
}

async function impots(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  if (sub === "etat") return fiscText(guildId);
  if (!isAdmin(interaction.member)) return "⛔ Réservé à l'OWNER, au propriétaire et aux administrateurs.";
  if (sub === "config") {
    const o = interaction.options;
    const patch = {};
    if (o.getInteger("transferts") !== null) patch.transferRate = o.getInteger("transferts");
    if (o.getInteger("fortune") !== null) patch.wealthRate = o.getInteger("fortune");
    if (o.getInteger("seuil") !== null) patch.wealthThreshold = o.getInteger("seuil");
    saveFiscConfig(guildId, patch, interaction.user.id);
    return fiscText(guildId);
  }
  if (sub === "verser") {
    const user = interaction.options.getUser("membre", true);
    const amount = interaction.options.getInteger("montant", true);
    if (user.bot) return "❌ Pas de versement à un bot.";
    transaction(() => { changeTreasury(guildId, -amount); move(guildId, user.id, amount, "treasury_payout"); });
    return `🏛️ **${fmt(amount)}** versés de la caisse à <@${user.id}>. Caisse : **${fmt(treasury(guildId))}**.`;
  }
  return "Action inconnue.";
}

/** Monday from 12:00 Paris, once per ISO week: wealth tax above the threshold. */
export function runWealthTax(guildIds, now = Date.now()) {
  const d = parisDate(now);
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  if (weekday !== 1 || d.hour < 12) return 0;
  let collected = 0;
  for (const guildId of guildIds) {
    const c = getFiscConfig(guildId);
    if (!c.wealthRate) continue;
    if (db.prepare("SELECT 1 FROM fisc_wealth_runs WHERE guild_id=? AND week=?").get(guildId, d.key)) continue;
    const total = transaction(() => {
      let sum = 0;
      for (const w of db.prepare("SELECT user_id, balance, bank FROM wallets WHERE guild_id=? AND balance+bank>?").all(guildId, c.wealthThreshold)) {
        const tax = Math.floor(((Number(w.balance) + Number(w.bank) - c.wealthThreshold) * c.wealthRate) / 100);
        if (tax > 0) sum += seize(guildId, w.user_id, tax, "wealth_tax");
      }
      if (sum) changeTreasury(guildId, sum);
      db.prepare("INSERT INTO fisc_wealth_runs(guild_id,week,collected) VALUES(?,?,?)").run(guildId, d.key, sum);
      return sum;
    });
    collected += total;
  }
  return collected;
}

// ---------------------------------------------------------------- Loans
export const LOAN_RULES = Object.freeze({ min: 100, max: 50_000, interest: 10, penalty: 5, maxDays: 14 });
export const loanCeiling = ({ balance, bank }) => Math.min(LOAN_RULES.max, Math.max(1000, Math.floor((balance + bank) * 2)));

async function pret(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const active = db.prepare("SELECT * FROM fisc_loans WHERE guild_id=? AND user_id=? AND status IN ('active','defaulted') ORDER BY id DESC LIMIT 1").get(guildId, userId);
  if (sub === "etat") {
    if (!active) return `🏦 Aucun prêt en cours. Tu peux emprunter jusqu'à **${fmt(loanCeiling(walletOf(guildId, userId)))}** (intérêts ${LOAN_RULES.interest} %).`;
    return `🏦 Prêt #${active.id} : reste **${fmt(active.owed)}** à rembourser, échéance <t:${Math.floor(active.due_at / 1000)}:R>${active.status === "defaulted" ? " — ⚠️ **en retard** : remboursement automatique en cours" : ""}.`;
  }
  if (sub === "demander") {
    if (active) return "❌ Tu as déjà un prêt en cours : rembourse-le d'abord (`/pret rembourser`).";
    const amount = interaction.options.getInteger("montant", true);
    const days = interaction.options.getInteger("jours") ?? 7;
    const ceiling = loanCeiling(walletOf(guildId, userId));
    if (amount < LOAN_RULES.min || amount > ceiling) return `❌ Montant possible : de ${fmt(LOAN_RULES.min)} à ${fmt(ceiling)}.`;
    const owed = amount + Math.ceil((amount * LOAN_RULES.interest) / 100);
    const due = Date.now() + days * 86_400_000;
    transaction(() => {
      db.prepare("INSERT INTO fisc_loans(guild_id,user_id,principal,owed,due_at,created_at) VALUES(?,?,?,?,?,?)").run(guildId, userId, amount, owed, due, Date.now());
      move(guildId, userId, amount, "loan_granted");
    });
    return `🏦 Prêt accordé : **${fmt(amount)}** versés. À rembourser : **${fmt(owed)}** avant <t:${Math.floor(due / 1000)}:F>. Passé ce délai, le remboursement est prélevé automatiquement (+${LOAN_RULES.penalty} % de pénalité).`;
  }
  if (sub === "rembourser") {
    if (!active) return "ℹ️ Aucun prêt à rembourser.";
    const wanted = Math.min(active.owed, interaction.options.getInteger("montant") ?? active.owed);
    const paid = transaction(() => {
      move(guildId, userId, -wanted, "loan_repaid");
      // Interest (and penalty) is paid first and goes to the server treasury; the principal is simply repaid.
      const interestShare = Math.min(wanted, Math.max(0, active.owed - active.principal));
      if (interestShare > 0) changeTreasury(guildId, interestShare);
      const left = active.owed - wanted;
      db.prepare("UPDATE fisc_loans SET owed=?, status=? WHERE id=?").run(left, left ? active.status : "repaid", active.id);
      return left;
    });
    return paid ? `✅ Remboursé **${fmt(wanted)}**. Reste **${fmt(paid)}**.` : "✅ Prêt entièrement remboursé, merci !";
  }
  return "Action inconnue.";
}

/** Hourly: overdue loans get a one-time penalty, then whatever is available is collected. */
export function runLoanCollection(now = Date.now()) {
  let collected = 0;
  for (const loan of db.prepare("SELECT * FROM fisc_loans WHERE status IN ('active','defaulted') AND due_at <= ?").all(now)) {
    transaction(() => {
      let owed = loan.owed;
      if (!loan.penalized) owed += Math.ceil((loan.owed * LOAN_RULES.penalty) / 100);
      const taken = seize(loan.guild_id, loan.user_id, owed, "loan_collected");
      if (taken) changeTreasury(loan.guild_id, taken);
      collected += taken;
      const left = owed - taken;
      db.prepare("UPDATE fisc_loans SET owed=?, penalized=1, status=? WHERE id=?").run(left, left ? "defaulted" : "repaid", loan.id);
    });
  }
  return collected;
}

// ---------------------------------------------------------------- Duels
const DUEL_GAMES = { pile: "Pile ou face", des: "Dés" };
const duelButtons = (id, disabled = false) => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`duel:accept:${id}`).setLabel("Accepter").setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId(`duel:refuse:${id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger).setDisabled(disabled),
)];

async function duel(interaction) {
  const guildId = interaction.guild.id;
  const opponent = interaction.options.getUser("membre", true);
  const bet = interaction.options.getInteger("mise", true);
  const game = interaction.options.getString("jeu") ?? "pile";
  if (opponent.bot || opponent.id === interaction.user.id) return "❌ Choisis un autre membre (pas un bot).";
  if (walletOf(guildId, interaction.user.id).balance < bet) return "❌ Tu n'as pas assez de PND pour cette mise.";
  const info = db.prepare("INSERT INTO fisc_duels(guild_id,challenger_id,opponent_id,bet,game,created_at) VALUES(?,?,?,?,?,?)").run(guildId, interaction.user.id, opponent.id, bet, game, Date.now());
  return { public: true, mentions: [opponent.id], content: `⚔️ <@${opponent.id}>, <@${interaction.user.id}> te défie en duel (**${DUEL_GAMES[game]}**) pour **${fmt(bet)}** chacun ! Tu as 2 minutes.`, components: duelButtons(info.lastInsertRowid) };
}

/** Pure: resolve a duel. `roll` returns an integer in [0, n). */
export function resolveDuel(game, roll = (n) => randomInt(n)) {
  if (game === "des") {
    let a; let b;
    do { a = roll(6) + 1; b = roll(6) + 1; } while (a === b);
    return { challengerWins: a > b, detail: `🎲 ${a} contre ${b}` };
  }
  const side = roll(2);
  return { challengerWins: side === 0, detail: side === 0 ? "🪙 Pile" : "🪙 Face" };
}

export async function handleDuelButton(interaction, { roll } = {}) {
  if (!interaction.isButton?.() || !/^duel:(accept|refuse):\d+$/.test(interaction.customId ?? "")) return false;
  const [, action, rawId] = interaction.customId.split(":");
  const row = db.prepare("SELECT * FROM fisc_duels WHERE id=? AND guild_id=?").get(Number(rawId), interaction.guildId);
  if (!row || row.status !== "pending") { await interaction.reply({ content: "Ce duel est terminé.", ephemeral: true }); return true; }
  if (interaction.user.id !== row.opponent_id) { await interaction.reply({ content: "Seule la personne défiée peut répondre.", ephemeral: true }); return true; }
  if (Date.now() - row.created_at > 120_000) {
    db.prepare("UPDATE fisc_duels SET status='expired' WHERE id=?").run(row.id);
    await interaction.update({ content: "⌛ Duel expiré.", components: duelButtons(row.id, true) });
    return true;
  }
  if (action === "refuse") {
    db.prepare("UPDATE fisc_duels SET status='refused' WHERE id=?").run(row.id);
    await interaction.update({ content: `🏳️ <@${row.opponent_id}> a refusé le duel.`, components: duelButtons(row.id, true), allowedMentions: { parse: [] } });
    return true;
  }
  let result;
  try {
    result = transaction(() => {
      const claimed = db.prepare("UPDATE fisc_duels SET status='done' WHERE id=? AND status='pending'").run(row.id);
      if (!Number(claimed.changes)) throw new Error("Ce duel est déjà joué.");
      move(row.guild_id, row.challenger_id, -row.bet, "duel_bet");
      move(row.guild_id, row.opponent_id, -row.bet, "duel_bet");
      const outcome = resolveDuel(row.game, roll);
      const winner = outcome.challengerWins ? row.challenger_id : row.opponent_id;
      move(row.guild_id, winner, row.bet * 2, "duel_win");
      db.prepare("UPDATE fisc_duels SET winner_id=? WHERE id=?").run(winner, row.id);
      return { ...outcome, winner };
    });
  } catch (error) {
    db.prepare("UPDATE fisc_duels SET status='pending' WHERE id=? AND status='done' AND winner_id IS NULL").run(row.id);
    await interaction.reply({ content: `❌ ${error.message.includes("insuffisant") ? "Un des deux joueurs n'a plus assez de PND." : error.message}`, ephemeral: true });
    return true;
  }
  await interaction.update({ content: `⚔️ Duel ${DUEL_GAMES[row.game]} : ${result.detail} → 🏆 <@${result.winner}> remporte **${fmt(row.bet * 2)}** !`, components: duelButtons(row.id, true), allowedMentions: { parse: [] } });
  return true;
}

// ---------------------------------------------------------------- Scratch card & horse race
const SCRATCH = [["💎", 1, 20], ["7️⃣", 3, 10], ["🍀", 8, 4], ["🍒", 20, 2]];
export function scratchOutcome(bet, roll = (n) => randomInt(n)) {
  const r = roll(100);
  let acc = 0;
  for (const [symbol, chance, mult] of SCRATCH) { acc += chance; if (r < acc) return { symbol, payout: bet * mult, win: true }; }
  return { symbol: "❌", payout: 0, win: false };
}
export function raceOutcome(bet, horse, roll = (n) => randomInt(n)) {
  const winner = roll(5) + 1;
  return { winner, payout: winner === horse ? bet * 4 : 0 };
}

async function pari(interaction) {
  const sub = interaction.options.getSubcommand();
  const bet = interaction.options.getInteger("mise", true);
  const base = { idempotencyKey: `pari:${interaction.id}`, guildId: interaction.guild.id, userId: interaction.user.id, bet };
  if (sub === "grattage") {
    const outcome = scratchOutcome(bet);
    const r = settleCasinoRound({ ...base, game: "grattage", payout: outcome.payout, outcome });
    return { public: true, content: `🎟️ Ticket à gratter : **${outcome.symbol} ${outcome.symbol} ${outcome.symbol}** → ${outcome.win ? `gagné **${fmt(outcome.payout)}** !` : "perdu."} Solde : **${fmt(r.balance)}**.` };
  }
  const horse = interaction.options.getInteger("cheval", true);
  const outcome = raceOutcome(bet, horse);
  const r = settleCasinoRound({ ...base, game: "course", payout: outcome.payout, outcome });
  const track = [1, 2, 3, 4, 5].map((h) => `${h === outcome.winner ? "🏁" : "  "} 🐎 ${h}${h === horse ? " ← ton cheval" : ""}`).join("\n");
  return { public: true, content: `🏇 **Course** — le cheval **${outcome.winner}** gagne !\n${track}\n${outcome.payout ? `Gagné **${fmt(outcome.payout)}** !` : "Perdu."} Solde : **${fmt(r.balance)}**.` };
}

export async function handleFiscInteraction(interaction) {
  if (await handleDuelButton(interaction)) return true;
  if (!interaction.isChatInputCommand?.() || !FISC_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.guild) { await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true }); return true; }
  try {
    const result = await { impots, pret, duel, pari }[interaction.commandName](interaction);
    const payload = typeof result === "string" ? { content: result } : { ...result };
    const isPublic = Boolean(payload.public);
    const users = payload.mentions ?? [];
    delete payload.public; delete payload.mentions;
    await interaction.reply({ ...payload, ephemeral: !isPublic, allowedMentions: { users } });
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
  }
  return true;
}
