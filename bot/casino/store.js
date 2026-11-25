// Persistent side of the PND Casino: staged rounds (games played over several
// button presses), the progressive jackpot and the VIP ladder.
//
// Single-shot games keep using settleCasinoRound in ../casino.js. Games where
// the stake grows while playing (blackjack splits, mines, crash) debit on the
// way in and credit once at the end, so a crash between two presses can never
// hand out a payout that was not staked.
import { randomUUID } from "node:crypto";
import { db, transaction } from "../database.js";
import { assertCasinoCanStart } from "../casino.js";

const MAX_BALANCE = 1_000_000_000_000;
const MAX_BET = 1_000_000_000;
export const JACKPOT_SEED = 10_000;
export const JACKPOT_RATE = 0.01;
const STALE_SESSION_MS = 2 * 60 * 60_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS casino_sessions (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, game TEXT NOT NULL,
    staked INTEGER NOT NULL, state_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    message_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS casino_sessions_owner ON casino_sessions(guild_id, user_id, status);
  CREATE TABLE IF NOT EXISTS casino_jackpot (
    guild_id TEXT PRIMARY KEY, amount INTEGER NOT NULL,
    last_winner TEXT, last_win_amount INTEGER, last_win_at INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS casino_cashback (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, day INTEGER NOT NULL,
    amount INTEGER NOT NULL, claimed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, day)
  );
`);

const validId = (value) => typeof value === "string" && /^\d{5,25}$/.test(value);
const requireIds = (guildId, userId) => {
  if (!validId(guildId) || !validId(userId)) throw new Error("Serveur ou joueur invalide.");
};

// ------------------------------------------------------------------ bank ----

/** Takes money out of the wallet. Must run inside a transaction with its caller. */
function debit(guildId, userId, amount, reason, now) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const taken = db.prepare("UPDATE wallets SET balance=balance-? WHERE guild_id=? AND user_id=? AND balance>=?")
    .run(amount, guildId, userId, amount);
  if (!Number(taken.changes)) throw new Error("Solde PND insuffisant pour cette mise.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, -amount, reason, now);
}

function credit(guildId, userId, amount, reason, now) {
  if (amount <= 0) return;
  const given = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance<=?")
    .run(amount, guildId, userId, MAX_BALANCE - amount);
  if (!Number(given.changes)) throw new Error("Le paiement dépasserait le solde maximal autorisé.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, amount, reason, now);
}

export const walletBalance = (guildId, userId) =>
  Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId)?.balance ?? 0);

// --------------------------------------------------------------- jackpot ----

export function jackpotAmount(guildId) {
  const row = db.prepare("SELECT amount FROM casino_jackpot WHERE guild_id=?").get(guildId);
  return row ? Number(row.amount) : JACKPOT_SEED;
}

export function jackpotInfo(guildId) {
  const row = db.prepare("SELECT amount,last_winner,last_win_amount,last_win_at FROM casino_jackpot WHERE guild_id=?").get(guildId);
  return {
    amount: row ? Number(row.amount) : JACKPOT_SEED,
    lastWinner: row?.last_winner ?? null,
    lastWinAmount: row?.last_win_amount == null ? null : Number(row.last_win_amount),
    lastWinAt: row?.last_win_at == null ? null : Number(row.last_win_at),
  };
}

/** Adds the house share of a stake to the pot. Must run inside the caller's transaction. */
function growJackpot(guildId, bet, now) {
  const share = Math.floor(bet * JACKPOT_RATE);
  if (share <= 0) return 0;
  db.prepare(`INSERT INTO casino_jackpot(guild_id,amount,updated_at) VALUES(?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET amount=MIN(?, casino_jackpot.amount+?), updated_at=?`)
    .run(guildId, JACKPOT_SEED + share, now, MAX_BALANCE, share, now);
  return share;
}

/** Empties the pot into the winner's wallet and reseeds it. Returns what was won. */
export function awardJackpot({ guildId, userId, now = Date.now() }) {
  requireIds(guildId, userId);
  return transaction(() => {
    const amount = jackpotAmount(guildId);
    if (amount <= 0) return 0;
    credit(guildId, userId, amount, "casino_jackpot_payout", now);
    db.prepare(`INSERT INTO casino_jackpot(guild_id,amount,last_winner,last_win_amount,last_win_at,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET
      amount=excluded.amount, last_winner=excluded.last_winner,
      last_win_amount=excluded.last_win_amount, last_win_at=excluded.last_win_at, updated_at=excluded.updated_at`)
      .run(guildId, JACKPOT_SEED, userId, amount, now, now);
    return amount;
  });
}

// ------------------------------------------------------------------- VIP ----

export const VIP_TIERS = Object.freeze([
  { key: "bronze", label: "Bronze", emoji: "🥉", from: 0, cashback: 0, maxBetBonus: 1 },
  { key: "argent", label: "Argent", emoji: "🥈", from: 50_000, cashback: 0.01, maxBetBonus: 1.5 },
  { key: "or", label: "Or", emoji: "🥇", from: 250_000, cashback: 0.02, maxBetBonus: 2 },
  { key: "platine", label: "Platine", emoji: "💠", from: 1_000_000, cashback: 0.03, maxBetBonus: 3 },
  { key: "diamant", label: "Diamant", emoji: "💎", from: 5_000_000, cashback: 0.05, maxBetBonus: 5 },
]);

/** Pure: the tier reached for a lifetime wagered amount, and what is left to the next one. */
export function vipTierFor(wagered) {
  const total = Math.max(0, Number(wagered) || 0);
  let index = 0;
  for (let i = 0; i < VIP_TIERS.length; i += 1) if (total >= VIP_TIERS[i].from) index = i;
  const next = VIP_TIERS[index + 1] ?? null;
  return { ...VIP_TIERS[index], wagered: total, next, toNext: next ? next.from - total : 0 };
}

export function vipStatus(guildId, userId) {
  const wagered = Number(db.prepare("SELECT COALESCE(SUM(bet),0) AS total FROM casino_rounds WHERE guild_id=? AND user_id=?")
    .get(guildId, userId)?.total ?? 0);
  return vipTierFor(wagered);
}

const dayNumber = (now) => Math.floor(now / 86_400_000);

/** Yesterday's net loss, which is what the cashback is a share of. */
export function cashbackDue(guildId, userId, now = Date.now()) {
  const tier = vipStatus(guildId, userId);
  if (!tier.cashback) return { amount: 0, tier, reason: "Le cashback démarre au rang Argent." };
  const day = dayNumber(now) - 1;
  if (db.prepare("SELECT 1 FROM casino_cashback WHERE guild_id=? AND user_id=? AND day=?").get(guildId, userId, day)) {
    return { amount: 0, tier, reason: "Cashback déjà récupéré pour hier." };
  }
  const row = db.prepare(`SELECT COALESCE(SUM(payout-bet),0) AS net FROM casino_rounds
    WHERE guild_id=? AND user_id=? AND created_at>=? AND created_at<?`)
    .get(guildId, userId, day * 86_400_000, (day + 1) * 86_400_000);
  const loss = Math.max(0, -Number(row?.net ?? 0));
  return { amount: Math.floor(loss * tier.cashback), tier, loss, day, reason: loss ? null : "Aucune perte hier." };
}

export function claimCashback({ guildId, userId, now = Date.now() }) {
  requireIds(guildId, userId);
  return transaction(() => {
    const due = cashbackDue(guildId, userId, now);
    if (due.amount <= 0) return due;
    db.prepare("INSERT INTO casino_cashback(guild_id,user_id,day,amount,claimed_at) VALUES(?,?,?,?,?)")
      .run(guildId, userId, due.day, due.amount, now);
    credit(guildId, userId, due.amount, "casino_cashback", now);
    return due;
  });
}

// -------------------------------------------------------------- sessions ----

/** Opens a staged round: the first stake leaves the wallet now. */
export function openRound({ guildId, userId, game, bet, state, now = Date.now() }) {
  requireIds(guildId, userId);
  if (!Number.isSafeInteger(bet) || bet < 1 || bet > MAX_BET) throw new Error("Mise invalide.");
  if (!/^[a-z_]{2,24}$/.test(String(game))) throw new Error("Jeu invalide.");
  return transaction(() => {
    const open = db.prepare("SELECT id FROM casino_sessions WHERE guild_id=? AND user_id=? AND status='open' AND updated_at>?")
      .get(guildId, userId, now - STALE_SESSION_MS);
    if (open) throw new Error("Tu as déjà une partie en cours. Termine-la avant d'en lancer une autre.");
    db.prepare("UPDATE casino_sessions SET status='abandoned', updated_at=? WHERE guild_id=? AND user_id=? AND status='open'")
      .run(now, guildId, userId);
    assertCasinoCanStart({ guildId, userId, bet, now });
    debit(guildId, userId, bet, `casino_${game}_bet`, now);
    growJackpot(guildId, bet, now);
    const id = randomUUID();
    db.prepare(`INSERT INTO casino_sessions(id,guild_id,user_id,game,staked,state_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'open',?,?)`).run(id, guildId, userId, game, bet, JSON.stringify(state ?? {}), now, now);
    return { id, guildId, userId, game, staked: bet, state, status: "open" };
  });
}

export function loadRound(id) {
  const row = db.prepare("SELECT * FROM casino_sessions WHERE id=?").get(id);
  if (!row) return null;
  return {
    id: row.id, guildId: row.guild_id, userId: row.user_id, game: row.game,
    staked: Number(row.staked), state: JSON.parse(row.state_json), status: row.status,
    messageId: row.message_id ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export const openRoundOf = (guildId, userId, now = Date.now()) => {
  const row = db.prepare("SELECT id FROM casino_sessions WHERE guild_id=? AND user_id=? AND status='open' AND updated_at>? ORDER BY updated_at DESC")
    .get(guildId, userId, now - STALE_SESSION_MS);
  return row ? loadRound(row.id) : null;
};

export function saveRoundState(id, state, now = Date.now()) {
  db.prepare("UPDATE casino_sessions SET state_json=?, updated_at=? WHERE id=? AND status='open'")
    .run(JSON.stringify(state), now, id);
}

export const rememberRoundMessage = (id, messageId) =>
  db.prepare("UPDATE casino_sessions SET message_id=? WHERE id=?").run(messageId, id);

/** Charges a stake added mid-round (double, split, insurance). */
export function stakeMore({ id, amount, now = Date.now() }) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Mise additionnelle invalide.");
  return transaction(() => {
    const round = loadRound(id);
    if (!round || round.status !== "open") throw new Error("Partie introuvable ou déjà terminée.");
    if (round.staked + amount > MAX_BET) throw new Error("Mise totale trop élevée pour cette partie.");
    assertCasinoCanStart({ guildId: round.guildId, userId: round.userId, bet: amount, now });
    debit(round.guildId, round.userId, amount, `casino_${round.game}_bet`, now);
    growJackpot(round.guildId, amount, now);
    db.prepare("UPDATE casino_sessions SET staked=staked+?, updated_at=? WHERE id=?").run(amount, now, id);
    return round.staked + amount;
  });
}

/**
 * Ends a staged round: credits the gross payout and files it in the history.
 * Idempotent — a second call on a closed round returns the stored result.
 */
export function closeRound({ id, payout, outcome, now = Date.now() }) {
  if (!Number.isSafeInteger(payout) || payout < 0) throw new Error("Paiement invalide.");
  return transaction(() => {
    const round = loadRound(id);
    if (!round) throw new Error("Partie introuvable.");
    if (round.status !== "open") {
      const stored = db.prepare("SELECT bet,payout FROM casino_rounds WHERE idempotency_key=?").get(id);
      return { duplicate: true, staked: round.staked, payout: Number(stored?.payout ?? 0), balance: walletBalance(round.guildId, round.userId) };
    }
    if (payout > round.staked * 1200) throw new Error("Paiement hors limites pour cette partie.");
    credit(round.guildId, round.userId, payout, `casino_${round.game}_payout`, now);
    db.prepare("UPDATE casino_sessions SET status='closed', state_json=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(outcome ?? {}), now, id);
    db.prepare(`INSERT OR IGNORE INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, round.guildId, round.userId, round.game, round.staked, payout, JSON.stringify(outcome ?? {}), now);
    return { duplicate: false, staked: round.staked, payout, net: payout - round.staked, balance: walletBalance(round.guildId, round.userId) };
  });
}

/** Single-shot games call this so their stake also feeds the pot. */
export const contributeJackpot = (guildId, bet, now = Date.now()) => transaction(() => growJackpot(guildId, bet, now));

export function casinoLeaderboard(guildId, limit = 10) {
  const bounded = Math.min(25, Math.max(1, Number(limit) || 10));
  return db.prepare(`SELECT user_id, COUNT(*) AS rounds, SUM(bet) AS wagered, SUM(payout-bet) AS net
    FROM casino_rounds WHERE guild_id=? GROUP BY user_id ORDER BY net DESC LIMIT ?`).all(guildId, bounded)
    .map((row) => ({ userId: row.user_id, rounds: Number(row.rounds), wagered: Number(row.wagered), net: Number(row.net) }));
}
