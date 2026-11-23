import { randomInt, randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db, transaction } from "./database.js";
import { assertCasinoCanStart } from "./casino.js";
import { brandEmbed } from "./theme.js";
import { isConfiguredPndOwner } from "./pnd-owner-policy.js";
import { listPndAdjustmentAudit, recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { LOTTERY_MAX_TICKETS, lotteryPayout, robPlan, ticketCost, workReward } from "./economy-policy.js";
import { JOBS, JOB_XP_PER_WORK, jobPayout, jobProgress } from "./job-policy.js";
import { DAILY_MISSIONS, advanceMission, missionDate } from "./mission-policy.js";
import { describeSignal, detectTransferSignals, evaluateTransfer, recordTransfer, senderWindow } from "./economy-antifraud.js";
import { isWhitelistMember } from "./systems/sysplus/whitelist-policy.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";

const purchaseLocks = new Set();
const marketLocks = new Set();
const MAX_BALANCE = 1_000_000_000_000;

function balance(guildId, userId) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  return Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId).balance);
}

function wallet(guildId, userId) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const row = db.prepare("SELECT balance, bank FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return { balance: Number(row.balance), bank: Number(row.bank) };
}

function changeBank(guildId, userId, delta) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const current = wallet(guildId, userId);
  if (current.bank + delta < 0) throw new Error("Banque PND insuffisante.");
  if (current.bank + delta > MAX_BALANCE) throw new Error(`La banque ne peut pas dépasser ${format(MAX_BALANCE)}.`);
  db.prepare("UPDATE wallets SET bank=bank+? WHERE guild_id=? AND user_id=?").run(delta, guildId, userId);
}

/** Crédit/débit contrôlé utilisable par les autres modules (jeux, cartes…). */
export function grantPnd(guildId, userId, amount, reason = "module_reward") {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("Montant PND invalide.");
  return transaction(() => changeBalance(guildId, userId, amount, reason));
}

export function pndBalance(guildId, userId) {
  return wallet(guildId, userId);
}

function contractText(value, maxLength, label) {
  if (typeof value !== "string") throw new Error(`${label} invalide.`);
  const clean = value.replace(/@/g, "＠").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > maxLength) throw new Error(`${label} doit contenir entre 1 et ${maxLength} caractères.`);
  return clean;
}

export function createEconomyContract(guildId, creatorId, { title, description, reward }) {
  const cleanTitle = contractText(title, 80, "Le titre");
  const cleanDescription = contractText(description, 500, "La description");
  if (!Number.isSafeInteger(reward) || reward < 1 || reward > 1_000_000_000) throw new Error("La récompense doit être comprise entre 1 et 1 000 000 000 PND.");
  return transaction(() => {
    changeBalance(guildId, creatorId, -reward, "contract_escrow");
    const now = Date.now();
    const result = db.prepare(`INSERT INTO economy_contracts
      (guild_id,creator_id,title,description,reward,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'open',?,?)`).run(guildId, creatorId, cleanTitle, cleanDescription, reward, now, now);
    return Number(result.lastInsertRowid);
  });
}

export function listEconomyContracts(guildId, status = "open", limit = 10) {
  if (!new Set(["open", "claimed", "submitted", "completed", "cancelled", "all"]).has(status)) throw new Error("État de contrat invalide.");
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  return db.prepare(`SELECT id,creator_id,claimant_id,title,description,submission,reward,status,created_at
    FROM economy_contracts WHERE guild_id=? AND (?='all' OR status=?) ORDER BY id DESC LIMIT ?`)
    .all(guildId, status, status, boundedLimit);
}

function contractForUpdate(guildId, contractId) {
  if (!Number.isSafeInteger(contractId) || contractId < 1) throw new Error("Identifiant de contrat invalide.");
  const row = db.prepare("SELECT * FROM economy_contracts WHERE guild_id=? AND id=?").get(guildId, contractId);
  if (!row) throw new Error("Contrat introuvable sur ce serveur.");
  return row;
}

export function claimEconomyContract(guildId, userId, contractId) {
  return transaction(() => {
    const row = contractForUpdate(guildId, contractId);
    if (row.status !== "open") throw new Error("Ce contrat n’est plus disponible.");
    if (row.creator_id === userId) throw new Error("Tu ne peux pas réclamer ton propre contrat.");
    const result = db.prepare("UPDATE economy_contracts SET claimant_id=?,status='claimed',updated_at=? WHERE guild_id=? AND id=? AND status='open'")
      .run(userId, Date.now(), guildId, contractId);
    if (!Number(result.changes)) throw new Error("Ce contrat vient d’être réclamé par quelqu’un d’autre.");
    return row;
  });
}

export function submitEconomyContract(guildId, userId, contractId, submission) {
  const cleanSubmission = contractText(submission, 500, "Le compte rendu");
  return transaction(() => {
    const row = contractForUpdate(guildId, contractId);
    if (row.claimant_id !== userId) throw new Error("Seule la personne qui a réclamé ce contrat peut le soumettre.");
    if (row.status !== "claimed") throw new Error("Ce contrat n’attend pas de compte rendu.");
    db.prepare("UPDATE economy_contracts SET submission=?,status='submitted',updated_at=? WHERE guild_id=? AND id=? AND status='claimed'")
      .run(cleanSubmission, Date.now(), guildId, contractId);
    return row;
  });
}

export function approveEconomyContract(guildId, creatorId, contractId) {
  return transaction(() => {
    const row = contractForUpdate(guildId, contractId);
    if (row.creator_id !== creatorId) throw new Error("Seul l’auteur du contrat peut valider le compte rendu.");
    if (row.status !== "submitted") throw new Error("Ce contrat n’a pas encore de compte rendu à valider.");
    const result = db.prepare("UPDATE economy_contracts SET status='completed',updated_at=? WHERE guild_id=? AND id=? AND status='submitted'")
      .run(Date.now(), guildId, contractId);
    if (!Number(result.changes)) throw new Error("Le contrat a déjà été traité.");
    changeBalance(guildId, row.claimant_id, Number(row.reward), "contract_reward");
    return row;
  });
}

export function cancelEconomyContract(guildId, creatorId, contractId) {
  return transaction(() => {
    const row = contractForUpdate(guildId, contractId);
    if (row.creator_id !== creatorId) throw new Error("Seul l’auteur du contrat peut l’annuler.");
    if (row.status !== "open") throw new Error("Un contrat réclamé ne peut plus être annulé.");
    const result = db.prepare("UPDATE economy_contracts SET status='cancelled',updated_at=? WHERE guild_id=? AND id=? AND status='open'")
      .run(Date.now(), guildId, contractId);
    if (!Number(result.changes)) throw new Error("Le contrat a déjà été traité.");
    changeBalance(guildId, creatorId, Number(row.reward), "contract_refund");
    return row;
  });
}

export function createMarketListing(guildId, sellerId, roleId, price) {
  if (!roleId || typeof roleId !== "string") throw new Error("Rôle de marché invalide.");
  if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) throw new Error("Le prix doit être compris entre 1 et 1 000 000 000 PND.");
  if (!db.prepare("SELECT 1 FROM shop_items WHERE guild_id=? AND role_id=?").get(guildId, roleId)) {
    throw new Error("Seuls les rôles provenant de la boutique de ce serveur peuvent être revendus.");
  }
  const existing = db.prepare("SELECT id FROM economy_market_listings WHERE guild_id=? AND seller_id=? AND role_id=? AND status IN ('open','pending')")
    .get(guildId, sellerId, roleId);
  if (existing) throw new Error("Tu as déjà une annonce ouverte pour ce rôle.");
  const now = Date.now();
  const result = db.prepare(`INSERT INTO economy_market_listings
    (guild_id,seller_id,role_id,price,status,created_at,updated_at) VALUES(?,?,?,?,'open',?,?)`)
    .run(guildId, sellerId, roleId, price, now, now);
  return Number(result.lastInsertRowid);
}

export function listMarketListings(guildId, limit = 10) {
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  return db.prepare(`SELECT id,seller_id,role_id,price,created_at FROM economy_market_listings
    WHERE guild_id=? AND status='open' ORDER BY id DESC LIMIT ?`).all(guildId, boundedLimit);
}

export function cancelMarketListing(guildId, sellerId, listingId) {
  if (!Number.isSafeInteger(listingId) || listingId < 1) throw new Error("Identifiant d’annonce invalide.");
  const result = db.prepare(`UPDATE economy_market_listings SET status='cancelled',updated_at=?
    WHERE guild_id=? AND id=? AND seller_id=? AND status='open'`).run(Date.now(), guildId, listingId, sellerId);
  if (!Number(result.changes)) throw new Error("Annonce introuvable, déjà achetée ou tu n’en es pas l’auteur.");
}

/** Transfers the Discord role first; wallet settlement is atomic and follows only after success. */
export async function buyMarketListing(guildId, buyerId, listingId, transferRole) {
  if (!Number.isSafeInteger(listingId) || listingId < 1) throw new Error("Identifiant d’annonce invalide.");
  if (typeof transferRole !== "function") throw new Error("Le transfert du rôle n’est pas disponible.");
  const lockKey = `${guildId}:${listingId}`;
  if (marketLocks.has(lockKey)) throw new Error("Cet achat est déjà en cours.");
  marketLocks.add(lockKey);
  let row;
  try {
    row = transaction(() => {
      const listing = db.prepare("SELECT * FROM economy_market_listings WHERE guild_id=? AND id=?").get(guildId, listingId);
      if (!listing || listing.status !== "open") throw new Error("Cette annonce n’est plus disponible.");
      if (listing.seller_id === buyerId) throw new Error("Tu ne peux pas acheter ta propre annonce.");
      const claimed = db.prepare("UPDATE economy_market_listings SET status='pending',buyer_id=?,updated_at=? WHERE guild_id=? AND id=? AND status='open'")
        .run(buyerId, Date.now(), guildId, listingId);
      if (!Number(claimed.changes)) throw new Error("Cette annonce vient d’être achetée.");
      return listing;
    });

    try {
      await transferRole({ guildId, sellerId: row.seller_id, buyerId, roleId: row.role_id });
    } catch {
      db.prepare("UPDATE economy_market_listings SET status='open',buyer_id=NULL,updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
        .run(Date.now(), guildId, listingId);
      throw new Error("Discord n’a pas pu transférer le rôle; aucun PND n’a été débité.");
    }

    try {
      transaction(() => {
        changeBalance(guildId, buyerId, -Number(row.price), "market_purchase");
        changeBalance(guildId, row.seller_id, Number(row.price), "market_sale");
        const settled = db.prepare("UPDATE economy_market_listings SET status='sold',updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
          .run(Date.now(), guildId, listingId);
        if (!Number(settled.changes)) throw new Error("L’annonce ne peut plus être réglée.");
      });
    } catch {
      try {
        await transferRole({ guildId, sellerId: row.seller_id, buyerId, roleId: row.role_id, reverse: true });
        db.prepare("UPDATE economy_market_listings SET status='open',buyer_id=NULL,updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
          .run(Date.now(), guildId, listingId);
      } catch {
        db.prepare("UPDATE economy_market_listings SET status='failed',updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
          .run(Date.now(), guildId, listingId);
      }
      throw new Error("Le règlement PND a échoué; le transfert a été annulé ou marqué pour vérification.");
    }
    return row;
  } finally {
    marketLocks.delete(lockKey);
  }
}

export function createEconomyAuction(guildId, sellerId, roleId, startPrice, durationMinutes, now = Date.now()) {
  if (!roleId || typeof roleId !== "string") throw new Error("Rôle d’enchère invalide.");
  if (!Number.isSafeInteger(startPrice) || startPrice < 1 || startPrice > 1_000_000_000) throw new Error("Prix initial invalide.");
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 10_080) throw new Error("La durée doit être comprise entre 10 minutes et 7 jours.");
  if (!db.prepare("SELECT 1 FROM shop_items WHERE guild_id=? AND role_id=?").get(guildId, roleId)) {
    throw new Error("Seuls les rôles de boutique de ce serveur peuvent être mis aux enchères.");
  }
  if (db.prepare("SELECT 1 FROM economy_auctions WHERE guild_id=? AND seller_id=? AND role_id=? AND status IN ('open','pending')").get(guildId, sellerId, roleId)) {
    throw new Error("Tu as déjà une enchère active pour ce rôle.");
  }
  const endsAt = now + durationMinutes * 60_000;
  const result = db.prepare(`INSERT INTO economy_auctions
    (guild_id,seller_id,role_id,start_price,status,ends_at,created_at,updated_at)
    VALUES(?,?,?,?,'open',?,?,?)`).run(guildId, sellerId, roleId, startPrice, endsAt, now, now);
  return Number(result.lastInsertRowid);
}

export function listEconomyAuctions(guildId, now = Date.now(), limit = 15) {
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 15));
  return db.prepare(`SELECT id,seller_id,role_id,start_price,highest_bid,highest_bidder_id,ends_at,status
    FROM economy_auctions WHERE guild_id=? AND status IN ('open','pending') AND ends_at>? ORDER BY ends_at ASC,id ASC LIMIT ?`)
    .all(guildId, now, boundedLimit);
}

export function placeEconomyAuctionBid(guildId, bidderId, auctionId, amount, now = Date.now()) {
  if (!Number.isSafeInteger(auctionId) || auctionId < 1) throw new Error("Identifiant d’enchère invalide.");
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) throw new Error("Montant de l’offre invalide.");
  return transaction(() => {
    const auction = db.prepare("SELECT * FROM economy_auctions WHERE guild_id=? AND id=?").get(guildId, auctionId);
    if (!auction || auction.status !== "open") throw new Error("Cette enchère n’est plus ouverte.");
    if (Number(auction.ends_at) <= now) throw new Error("Cette enchère est terminée; le règlement automatique est en attente.");
    if (auction.seller_id === bidderId) throw new Error("Tu ne peux pas enchérir sur ta propre enchère.");
    if (auction.highest_bidder_id === bidderId) throw new Error("Tu es déjà le meilleur enchérisseur.");
    const minimum = Math.max(Number(auction.start_price), Number(auction.highest_bid) + 1);
    if (amount < minimum) throw new Error(`L’offre minimale est de ${format(minimum)}.`);
    changeBalance(guildId, bidderId, -amount, "auction_bid_escrow");
    if (auction.highest_bidder_id) changeBalance(guildId, auction.highest_bidder_id, Number(auction.highest_bid), "auction_outbid_refund");
    const updated = db.prepare(`UPDATE economy_auctions SET highest_bid=?,highest_bidder_id=?,updated_at=?
      WHERE guild_id=? AND id=? AND status='open' AND ends_at>?`).run(amount, bidderId, now, guildId, auctionId, now);
    if (!Number(updated.changes)) throw new Error("L’enchère vient de se terminer.");
    return { previousBidderId: auction.highest_bidder_id, previousBid: Number(auction.highest_bid), amount, endsAt: Number(auction.ends_at) };
  });
}

export function cancelEconomyAuction(guildId, sellerId, auctionId) {
  const result = db.prepare(`UPDATE economy_auctions SET status='cancelled',updated_at=?
    WHERE guild_id=? AND id=? AND seller_id=? AND status='open' AND highest_bidder_id IS NULL`)
    .run(Date.now(), guildId, auctionId, sellerId);
  if (!Number(result.changes)) throw new Error("Seule une enchère sans offre peut être annulée par son auteur.");
}

export async function settleExpiredEconomyAuctions(now = Date.now(), transferRole = async () => {
  throw new Error("Transfert Discord non disponible.");
}) {
  const due = db.prepare("SELECT * FROM economy_auctions WHERE status='open' AND ends_at<=? ORDER BY ends_at ASC LIMIT 50").all(now);
  const result = { sold: 0, expired: 0, failed: 0 };
  for (const auction of due) {
    if (!auction.highest_bidder_id) {
      const expired = db.prepare("UPDATE economy_auctions SET status='expired',updated_at=? WHERE guild_id=? AND id=? AND status='open'")
        .run(now, auction.guild_id, auction.id);
      if (Number(expired.changes)) result.expired++;
      continue;
    }
    const claimed = db.prepare("UPDATE economy_auctions SET status='pending',updated_at=? WHERE guild_id=? AND id=? AND status='open'")
      .run(now, auction.guild_id, auction.id);
    if (!Number(claimed.changes)) continue;
    let transferred = false;
    try {
      await transferRole({ guildId: auction.guild_id, sellerId: auction.seller_id, buyerId: auction.highest_bidder_id, roleId: auction.role_id });
      transferred = true;
      transaction(() => {
        changeBalance(auction.guild_id, auction.seller_id, Number(auction.highest_bid), "auction_sale");
        const sold = db.prepare("UPDATE economy_auctions SET status='sold',updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
          .run(Date.now(), auction.guild_id, auction.id);
        if (!Number(sold.changes)) throw new Error("Enchère impossible à régler.");
      });
      result.sold++;
    } catch {
      if (transferred) {
        try {
          await transferRole({ guildId: auction.guild_id, sellerId: auction.seller_id, buyerId: auction.highest_bidder_id, roleId: auction.role_id, reverse: true });
        } catch {
          db.prepare("UPDATE economy_auctions SET status='failed',updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
            .run(Date.now(), auction.guild_id, auction.id);
          result.failed++;
          continue;
        }
      }
      try {
        transaction(() => {
          changeBalance(auction.guild_id, auction.highest_bidder_id, Number(auction.highest_bid), "auction_failed_refund");
          db.prepare("UPDATE economy_auctions SET status='failed',updated_at=? WHERE guild_id=? AND id=? AND status='pending'")
            .run(Date.now(), auction.guild_id, auction.id);
        });
        result.failed++;
      } catch {
        // Preserve escrow and pending status for explicit operator reconciliation.
      }
    }
  }
  return result;
}

export function cooldownRemaining(guildId, userId, action, now = Date.now()) {
  const row = db.prepare("SELECT ready_at FROM economy_cooldowns WHERE guild_id=? AND user_id=? AND action=?").get(guildId, userId, action);
  return row ? Math.max(0, Number(row.ready_at) - now) : 0;
}

export function setCooldown(guildId, userId, action, readyAt) {
  db.prepare("INSERT INTO economy_cooldowns(guild_id,user_id,action,ready_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id,action) DO UPDATE SET ready_at=excluded.ready_at")
    .run(guildId, userId, action, readyAt);
}

function changeBalance(guildId, userId, delta, reason = "adjustment") {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance) VALUES(?,?,0)").run(guildId, userId);
  const current = balance(guildId, userId);
  if (current + delta > MAX_BALANCE) throw new Error(`Le solde ne peut pas dépasser ${format(MAX_BALANCE)}.`);
  if (delta < 0) {
    const result = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance>=?").run(delta, guildId, userId, -delta);
    if (!Number(result.changes)) throw new Error("Solde PND insuffisant.");
  } else {
    db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=?").run(delta, guildId, userId);
  }
  if (delta) db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)").run(guildId, userId, delta, reason, Date.now());
  return balance(guildId, userId);
}

function format(value) { return `${Number(value).toLocaleString("fr-FR")} PND`; }
function mention(id) { return `<@${id}>`; }
function admin(member) {
  return member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}
function safeReply(message, content) {
  return message.reply({ content, allowedMentions: { parse: [] } });
}
function parseAmount(raw, allowZero = false) {
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 1_000_000_000) throw new Error(`Indique un montant entier entre ${allowZero ? 0 : 1} et 1 000 000 000.`);
  return amount;
}
function getMentionedRole(message, raw) {
  return message.mentions.roles.first() ?? message.guild.roles.cache.get(String(raw ?? "").replace(/[<@&>]/g, ""));
}
function roleIsAssignable(role, bot) {
  return role && !role.managed && role.id !== role.guild.id && role.position < bot.roles.highest.position;
}

export async function transferEconomyRole(guild, { sellerId, buyerId, roleId, reverse = false }) {
  const [seller, buyer, role, bot] = await Promise.all([
    guild.members.fetch({ user: sellerId, force: true }),
    guild.members.fetch({ user: buyerId, force: true }),
    guild.roles.fetch(roleId),
    guild.members.fetchMe(),
  ]);
  if (!roleIsAssignable(role, bot)) throw new Error("Rôle devenu intransférable.");
  const from = reverse ? buyer : seller;
  const to = reverse ? seller : buyer;
  if (!from.roles.cache.has(roleId) || to.roles.cache.has(roleId)) throw new Error("État de possession du rôle incohérent.");
  let removed = false;
  try {
    await from.roles.remove(role, "Transfert de rôle PND");
    removed = true;
    await to.roles.add(role, "Transfert de rôle PND");
  } catch (error) {
    if (to.roles.cache.has(roleId)) await to.roles.remove(role, "Annulation du transfert PND").catch(() => {});
    if (removed && !from.roles.cache.has(roleId)) await from.roles.add(role, "Restauration après échec PND").catch(() => {});
    throw error;
  }
}

function ensureDailyMissions(guildId, userId, date = missionDate()) {
  for (const mission of DAILY_MISSIONS) {
    db.prepare(`INSERT OR IGNORE INTO economy_daily_missions
      (guild_id,user_id,mission_date,mission_key,progress,target,reward,claimed)
      VALUES(?,?,?,?,0,?,?,0)`).run(guildId, userId, date, mission.key, mission.target, mission.reward);
  }
}

export function recordMissionProgress(guildId, userId, action, date = missionDate()) {
  ensureDailyMissions(guildId, userId, date);
  for (const mission of DAILY_MISSIONS.filter((entry) => entry.action === action)) {
    const row = db.prepare(`SELECT progress,target FROM economy_daily_missions
      WHERE guild_id=? AND user_id=? AND mission_date=? AND mission_key=? AND claimed=0`)
      .get(guildId, userId, date, mission.key);
    if (!row) continue;
    const next = advanceMission(Number(row.progress), Number(row.target));
    db.prepare(`UPDATE economy_daily_missions SET progress=?
      WHERE guild_id=? AND user_id=? AND mission_date=? AND mission_key=? AND claimed=0`)
      .run(next.progress, guildId, userId, date, mission.key);
  }
}

export function dailyMissionRows(guildId, userId, date = missionDate()) {
  ensureDailyMissions(guildId, userId, date);
  return db.prepare(`SELECT mission_key,progress,target,reward,claimed FROM economy_daily_missions
    WHERE guild_id=? AND user_id=? AND mission_date=? ORDER BY mission_key`)
    .all(guildId, userId, date);
}

export function claimDailyMissions(guildId, userId, date = missionDate()) {
  return transaction(() => {
    ensureDailyMissions(guildId, userId, date);
    const completed = db.prepare(`SELECT mission_key,reward FROM economy_daily_missions
      WHERE guild_id=? AND user_id=? AND mission_date=? AND progress>=target AND claimed=0`)
      .all(guildId, userId, date);
    let reward = 0;
    let count = 0;
    const markClaimed = db.prepare(`UPDATE economy_daily_missions SET claimed=1
      WHERE guild_id=? AND user_id=? AND mission_date=? AND mission_key=? AND claimed=0 AND progress>=target`);
    for (const mission of completed) {
      if (!Number(markClaimed.run(guildId, userId, date, mission.mission_key).changes)) continue;
      reward += Number(mission.reward);
      count++;
    }
    if (reward) changeBalance(guildId, userId, reward, "mission_reward");
    return { reward, count };
  });
}

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const activeGameActions = new Set();
function drawCard() { return { rank: RANKS[randomInt(RANKS.length)], suit: SUITS[randomInt(SUITS.length)] }; }
function handValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    if (card.rank === "A") { total += 11; aces++; }
    else total += ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank);
  }
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}
function handText(cards, hideHole = false) {
  return cards.map((card, index) => hideHole && index === 1 ? "🂠" : `${card.rank}${card.suit}`).join("  ");
}
function blackjackButtons(gameId, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`economy:bj:${gameId}:hit`).setLabel("Tirer").setEmoji("🃏").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`economy:bj:${gameId}:stand`).setLabel("Rester").setEmoji("✋").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  )];
}

function blackjackEmbed(game, reveal = false, result = "À toi de jouer.") {
  return brandEmbed(new EmbedBuilder().setColor(0x6d28d9).setTitle("🃏 Blackjack · PND")
    .addFields(
      { name: `Ta main (${handValue(game.playerCards)})`, value: handText(game.playerCards), inline: true },
      { name: `Croupier${reveal ? ` (${handValue(game.dealerCards)})` : ""}`, value: handText(game.dealerCards, !reveal), inline: true },
      { name: "Mise", value: format(game.bet), inline: true },
    ).setDescription(result));
}

function settleGame(game, outcome) {
  return transaction(() => {
    const exists = db.prepare("SELECT game_id FROM active_blackjack WHERE game_id=?").get(game.gameId);
    if (!exists) throw new Error("Cette partie est déjà terminée.");
    let payout = 0;
    if (outcome === "win") { payout = game.bet * 2; changeBalance(game.guildId, game.userId, payout, "blackjack_win"); }
    else if (outcome === "blackjack") { payout = Math.floor(game.bet * 2.5); changeBalance(game.guildId, game.userId, payout, "blackjack_natural"); }
    else if (outcome === "push") { payout = game.bet; changeBalance(game.guildId, game.userId, payout, "blackjack_push"); }
    db.prepare(`INSERT OR IGNORE INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(`blackjack:${game.gameId}`, game.guildId, game.userId, "blackjack", game.bet, payout, JSON.stringify({ outcome }), Date.now());
    db.prepare("DELETE FROM active_blackjack WHERE game_id=?").run(game.gameId);
  });
}

/** Refund in-progress bets after a crash/restart; no player loses a stake to a process restart. */
export function recoverBlackjackGames() {
  transaction(() => {
    const games = db.prepare("SELECT guild_id,user_id,bet FROM active_blackjack").all();
    for (const game of games) changeBalance(game.guild_id, game.user_id, Number(game.bet), "blackjack_restart_refund");
    db.exec("DELETE FROM active_blackjack");
  });
}

/**
 * Read-only, bounded mirror of one guild's economy for the V4 dashboard.
 * SQLite stays the source of truth; the dashboard only displays this snapshot.
 */
export function economySnapshot(guildId, guild = null) {
  const totals = db.prepare("SELECT COUNT(*) AS wallets, COALESCE(SUM(balance + bank), 0) AS total FROM wallets WHERE guild_id=?").get(guildId);
  const ledger = db.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE guild_id=?").get(guildId);
  const daily = db.prepare("SELECT COUNT(*) AS count FROM daily_claims WHERE guild_id=?").get(guildId);
  const games = db.prepare("SELECT COUNT(*) AS count FROM active_blackjack WHERE guild_id=?").get(guildId);
  const top = db.prepare("SELECT user_id, balance + bank AS balance FROM wallets WHERE guild_id=? AND balance + bank > 0 ORDER BY balance DESC, user_id ASC LIMIT 10").all(guildId);
  const shop = db.prepare("SELECT role_id, price FROM shop_items WHERE guild_id=? ORDER BY price ASC LIMIT 25").all(guildId);

  const displayName = (userId) => {
    const name = guild?.members?.cache?.get(userId)?.displayName;
    return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : null;
  };

  return {
    guildId,
    guildName: typeof guild?.name === "string" && guild.name.trim() ? guild.name.trim().slice(0, 100) : null,
    totalBalance: Number(totals?.total ?? 0),
    walletCount: Number(totals?.wallets ?? 0),
    ledgerCount: Number(ledger?.count ?? 0),
    dailyClaims: Number(daily?.count ?? 0),
    activeGames: Number(games?.count ?? 0),
    topWallets: top.map((entry) => ({
      userId: entry.user_id,
      displayName: displayName(entry.user_id),
      balance: Number(entry.balance),
    })),
    shopItems: shop.map((item) => {
      const roleName = guild?.roles?.cache?.get(item.role_id)?.name;
      return {
        roleId: item.role_id,
        roleName: typeof roleName === "string" ? roleName.slice(0, 100) : null,
        price: Number(item.price),
      };
    }),
    capturedAt: new Date().toISOString(),
  };
}

export async function handleEconomyMessage(message, guildSettings = null) {
  if (!message.guild || !message.member) return false;
  let parts = message.content.trim().split(/\s+/);
  let command = (parts[0] ?? "").toLowerCase();
  if (command === "=casino" && (parts[1] ?? "").toLowerCase() === "blackjack") {
    parts = ["=blackjack", ...parts.slice(2)];
    command = "=blackjack";
  }
  const known = new Set(["=balance", "=solde", "=daily", "=pay", "=shop", "=buy", "=inventory", "=leaderboard", "=roulette", "=blackjack", "=pnd", "=pnd-history", "=pnd-audit", "=work", "=job", "=bank", "=history", "=rob", "=lottery", "=mission", "=market", "=auction"]);
  if (!known.has(command)) return false;
  const gid = message.guild.id, uid = message.author.id;
  try {
    if (command === "=balance" || command === "=solde") {
      const target = message.mentions.users.first() ?? message.author;
      const amount = balance(gid, target.id);
      await safeReply(message, `💰 Solde de ${target.id === uid ? "toi" : mention(target.id)} : **${format(amount)}**.`);
    } else if (command === "=daily") {
      const reward = 100 + randomInt(151), now = Date.now(), cooldown = 20 * 60 * 60_000;
      const claim = transaction(() => {
        const previous = db.prepare("SELECT claimed_at FROM daily_claims WHERE guild_id=? AND user_id=?").get(gid, uid);
        if (previous && now - Number(previous.claimed_at) < cooldown) return { remaining: cooldown - (now - Number(previous.claimed_at)) };
        db.prepare("INSERT INTO daily_claims(guild_id,user_id,claimed_at) VALUES(?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET claimed_at=excluded.claimed_at").run(gid, uid, now);
        changeBalance(gid, uid, reward, "daily_reward");
        return { reward, total: balance(gid, uid) };
      });
      if (claim.remaining) await safeReply(message, `⏳ Ton bonus quotidien est déjà récupéré. Réessaie dans **${Math.ceil(claim.remaining / 3_600_000)} h**.`);
      else await safeReply(message, `🎁 Tu as reçu **${format(claim.reward)}**. Nouveau solde : **${format(claim.total)}**.`);
    } else if (command === "=work") {
      const remaining = cooldownRemaining(gid, uid, "work");
      if (remaining) throw new Error(`⏳ Tu pourras retravailler dans **${Math.ceil(remaining / 60_000)} min**.`);
      const profile = db.prepare(`SELECT p.job_key,p.level,p.experience FROM economy_member_jobs m
        JOIN economy_job_profiles p ON p.guild_id=m.guild_id AND p.user_id=m.user_id AND p.job_key=m.job_key
        WHERE m.guild_id=? AND m.user_id=?`).get(gid, uid);
      const baseReward = workReward(randomInt(1_000_000) / 1_000_000);
      const reward = jobPayout(baseReward, profile?.level ?? 1);
      const result = transaction(() => {
        setCooldown(gid, uid, "work", Date.now() + 60 * 60_000);
        const total = changeBalance(gid, uid, reward, "work_reward");
        recordMissionProgress(gid, uid, "work");
        if (!profile) return { total, progress: null };
        const progress = jobProgress({ level: Number(profile.level), experience: Number(profile.experience), earned: JOB_XP_PER_WORK });
        db.prepare("UPDATE economy_job_profiles SET level=?,experience=?,updated_at=? WHERE guild_id=? AND user_id=? AND job_key=?")
          .run(progress.level, progress.experience, Date.now(), gid, uid, profile.job_key);
        return { total, progress };
      });
      const jobLine = profile ? ` Métier : **${JOBS[profile.job_key]?.label ?? "Métier"}** niveau ${result.progress.level}${result.progress.levelsGained ? ` (niveau +${result.progress.levelsGained})` : ` · ${result.progress.experience}/100 XP`}.` : " Choisis un métier avec `=job choose` pour gagner de l’expérience et un bonus progressif.";
      await safeReply(message, `🛠️ Tu as travaillé et gagné **${format(reward)}**.${jobLine} Solde : **${format(result.total)}**.`);
    } else if (command === "=mission") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "status" || action === "état") {
        const rows = dailyMissionRows(gid, uid);
        const lines = rows.map((row) => {
          const mission = DAILY_MISSIONS.find((entry) => entry.key === row.mission_key);
          const state = row.claimed ? "✅ Récompensée" : Number(row.progress) >= Number(row.target) ? "🎁 À réclamer" : `${row.progress}/${row.target}`;
          return `• **${mission?.label ?? row.mission_key}** — ${state} · ${format(row.reward)}`;
        });
        await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("📋 Missions PND du jour").setDescription(lines.join("\n") || "Aucune mission disponible."))], allowedMentions: { parse: [] } });
      } else if (action === "claim" || action === "réclamer" || action === "reclamer") {
        const result = claimDailyMissions(gid, uid);
        if (!result.count || !result.reward) throw new Error("Aucune mission terminée à réclamer aujourd’hui.");
        await safeReply(message, `🎉 Récompense de **${result.count} mission(s)** : **${format(result.reward)}** ajoutés à ton portefeuille.`);
      } else {
        throw new Error("Utilisation : `=mission status|claim`.");
      }
    } else if (command === "=job") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "contract") {
        const payload = message.economyContract;
        const contractAction = payload?.action ?? (parts[2] ?? "list").toLowerCase();
        if (contractAction === "create") {
          const contractId = createEconomyContract(gid, uid, payload ?? {
            reward: Number(parts[3]), title: parts[4], description: parts.slice(5).join(" "),
          });
          await safeReply(message, `✅ Contrat **#${contractId}** publié. Sa récompense a été réservée dans l’escrow PND.`);
        } else if (contractAction === "list") {
          const rows = listEconomyContracts(gid, payload?.status ?? "open");
          const lines = rows.map((row) => `• **#${row.id} ${row.title}** — ${format(row.reward)} · ${row.status} · auteur <@${row.creator_id}>${row.claimant_id ? ` · exécutant <@${row.claimant_id}>` : ""}\n  ${row.description.slice(0, 180)}${row.submission ? `\n  Compte rendu : ${row.submission.slice(0, 180)}` : ""}`);
          const summary = (lines.join("\n").slice(0, 3_800) || "Aucun contrat dans cet état.");
          await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("📜 Contrats PND").setDescription(summary))], allowedMentions: { parse: [] } });
        } else {
          const contractId = Number(payload?.contractId ?? parts[3]);
          if (contractAction === "claim") {
            claimEconomyContract(gid, uid, contractId);
            await safeReply(message, `✅ Tu as réclamé le contrat **#${contractId}**. Soumets ton compte rendu avec /job contract submit.`);
          } else if (contractAction === "submit") {
            submitEconomyContract(gid, uid, contractId, payload?.submission ?? parts.slice(4).join(" "));
            await safeReply(message, `📨 Le compte rendu du contrat **#${contractId}** a été envoyé à son auteur.`);
          } else if (contractAction === "approve") {
            const row = approveEconomyContract(gid, uid, contractId);
            await safeReply(message, `🎉 Contrat **#${contractId}** validé : ${format(row.reward)} versés à <@${row.claimant_id}>.`);
          } else if (contractAction === "cancel") {
            const row = cancelEconomyContract(gid, uid, contractId);
            await safeReply(message, `↩️ Contrat **#${contractId}** annulé. ${format(row.reward)} ont été rendus à ton portefeuille.`);
          } else {
            throw new Error("Utilisation : `/job contract create|list|claim|submit|approve|cancel`.");
          }
        }
      } else if (action === "list") {
        const lines = Object.entries(JOBS).map(([key, job]) => `• \`${key}\` — **${job.label}** : ${job.description}.`);
        await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("🧰 Métiers PND").setDescription(lines.join("\n")).setFooter({ text: "Choisis un métier avec =job choose <métier>. La progression est propre à ce serveur." }))], allowedMentions: { parse: [] } });
      } else if (action === "choose" || action === "choisir") {
        const jobKey = (parts[2] ?? "").toLowerCase();
        const job = JOBS[jobKey];
        if (!job) throw new Error(`Choisis un métier valide avec \`=job list\` : ${Object.keys(JOBS).join(", ")}.`);
        transaction(() => {
          db.prepare(`INSERT OR IGNORE INTO economy_job_profiles(guild_id,user_id,job_key,level,experience,updated_at)
            VALUES(?,?,?,1,0,?)`).run(gid, uid, jobKey, Date.now());
          db.prepare(`INSERT INTO economy_member_jobs(guild_id,user_id,job_key,changed_at) VALUES(?,?,?,?)
            ON CONFLICT(guild_id,user_id) DO UPDATE SET job_key=excluded.job_key,changed_at=excluded.changed_at`).run(gid, uid, jobKey, Date.now());
        });
        await safeReply(message, `✅ Ton métier est maintenant **${job.label}**. La progression de chaque métier est conservée séparément.`);
      } else if (action === "status" || action === "etat" || action === "état") {
        const profile = db.prepare(`SELECT p.job_key,p.level,p.experience FROM economy_member_jobs m
          JOIN economy_job_profiles p ON p.guild_id=m.guild_id AND p.user_id=m.user_id AND p.job_key=m.job_key
          WHERE m.guild_id=? AND m.user_id=?`).get(gid, uid);
        if (!profile) await safeReply(message, "Tu n’as pas encore choisi de métier. Consulte `=job list`, puis utilise `=job choose <métier>`." );
        else await safeReply(message, `🧰 Métier : **${JOBS[profile.job_key]?.label ?? "Métier"}** · niveau **${profile.level}** · **${profile.experience}/100 XP** · bonus de travail **+${Math.min(45, (Number(profile.level) - 1) * 5)} %**.`);
      } else {
        throw new Error("Utilisation : `=job list|status|choose métier`.");
      }
    } else if (command === "=bank") {
      const action = (parts[1] ?? "solde").toLowerCase();
      if (action === "solde" || action === "balance") {
        const w = wallet(gid, uid);
        await safeReply(message, `🏦 Portefeuille : **${format(w.balance)}** · Banque : **${format(w.bank)}** · Total : **${format(w.balance + w.bank)}**.`);
      } else if (["deposit", "deposer", "déposer"].includes(action)) {
        const amount = parseAmount(parts[2]);
        const w = transaction(() => {
          const current = wallet(gid, uid);
          if (current.balance < amount) throw new Error("Solde PND insuffisant pour ce dépôt.");
          changeBalance(gid, uid, -amount, "bank_deposit");
          changeBank(gid, uid, amount);
          return wallet(gid, uid);
        });
        await safeReply(message, `🏦 **${format(amount)}** déposés en banque. Banque : **${format(w.bank)}**.`);
      } else if (["withdraw", "retirer", "retrait"].includes(action)) {
        const amount = parseAmount(parts[2]);
        const w = transaction(() => {
          changeBank(gid, uid, -amount);
          changeBalance(gid, uid, amount, "bank_withdraw");
          return wallet(gid, uid);
        });
        await safeReply(message, `🏦 **${format(amount)}** retirés de la banque. Portefeuille : **${format(w.balance)}**.`);
      } else {
        throw new Error("Utilisation : `=bank solde|deposit montant|withdraw montant`.");
      }
    } else if (command === "=history") {
      const rows = db.prepare("SELECT delta,reason,created_at FROM economy_ledger WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 10").all(gid, uid);
      const labels = {
        daily_reward: "Bonus quotidien", work_reward: "Travail", transfer_sent: "Transfert envoyé",
        transfer_received: "Transfert reçu", bank_deposit: "Dépôt banque", bank_withdraw: "Retrait banque",
        roulette_bet: "Mise roulette", roulette_payout: "Gain roulette", blackjack_bet: "Mise blackjack",
        blackjack_win: "Gain blackjack", blackjack_natural: "Blackjack", blackjack_push: "Égalité blackjack",
        shop_purchase: "Achat boutique", shop_refund: "Remboursement boutique", rob_success: "Vol réussi",
        rob_failed: "Vol raté", lottery_ticket: "Ticket loterie", lottery_win: "Gain loterie",
      };
      const lines = rows.map((row) => {
        const sign = Number(row.delta) >= 0 ? "+" : "";
        const date = new Date(Number(row.created_at)).toLocaleDateString("fr-FR");
        return `• ${date} — **${sign}${format(row.delta)}** — ${labels[row.reason] ?? row.reason}`;
      });
      await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("📜 Historique PND").setDescription(lines.length ? lines.join("\n") : "Aucun mouvement pour le moment."))], allowedMentions: { parse: [] } });
    } else if (command === "=rob") {
      const target = message.mentions.users.first();
      if (!target || target.bot || target.id === uid) throw new Error("Utilisation : `=rob @membre`.");
      const remaining = cooldownRemaining(gid, uid, "rob");
      if (remaining) throw new Error(`⏳ Tu pourras retenter un vol dans **${Math.ceil(remaining / 60_000)} min**.`);
      const victim = wallet(gid, target.id).balance;
      const plan = robPlan({ victimBalance: victim, ownBalance: wallet(gid, uid).balance, roll: randomInt(1_000_000) / 1_000_000 });
      if (!plan.allowed) throw new Error("Cette personne n’a pas assez de PND à voler.");
      const outcome = transaction(() => {
        setCooldown(gid, uid, "rob", Date.now() + 2 * 60 * 60_000);
        if (plan.success) {
          changeBalance(gid, target.id, -plan.amount, "rob_victim");
          return { total: changeBalance(gid, uid, plan.amount, "rob_success"), fine: 0 };
        }
        if (plan.fine > 0) {
          changeBalance(gid, uid, -plan.fine, "rob_failed");
          changeBalance(gid, target.id, plan.fine, "rob_restitution");
        }
        return { total: wallet(gid, uid).balance, fine: plan.fine };
      });
      await safeReply(message, plan.success
        ? `🕵️ Tu as volé **${format(plan.amount)}** à ${mention(target.id)}. Solde : **${format(outcome.total)}**.`
        : `🚨 Vol raté ! Tu as dû rendre **${format(outcome.fine)}** à ${mention(target.id)}. Solde : **${format(outcome.total)}**.`);
    } else if (command === "=lottery") {
      const action = (parts[1] ?? "info").toLowerCase();
      const openDraw = () => db.prepare("SELECT * FROM lottery_draws WHERE guild_id=? AND winner_id IS NULL ORDER BY id DESC LIMIT 1").get(gid);
      if (action === "buy" || action === "acheter") {
        const { tickets: count, cost } = ticketCost(Number.parseInt(parts[2] ?? "1", 10) || 1);
        const result = transaction(() => {
          let draw = openDraw();
          if (!draw) {
            const info = db.prepare("INSERT INTO lottery_draws(guild_id,pot,winner_id,created_at) VALUES(?,?,NULL,?)").run(gid, 0, Date.now());
            draw = { id: Number(info.lastInsertRowid), pot: 0 };
          }
          const mine = db.prepare("SELECT COUNT(*) AS count FROM lottery_tickets WHERE guild_id=? AND draw_id=? AND user_id=?").get(gid, draw.id, uid).count;
          if (Number(mine) + count > LOTTERY_MAX_TICKETS) throw new Error(`Maximum ${LOTTERY_MAX_TICKETS} tickets par personne et par tirage.`);
          changeBalance(gid, uid, -cost, "lottery_ticket");
          for (let i = 0; i < count; i++) db.prepare("INSERT INTO lottery_tickets(guild_id,user_id,draw_id,created_at) VALUES(?,?,?,?)").run(gid, uid, draw.id, Date.now());
          db.prepare("UPDATE lottery_draws SET pot=pot+? WHERE id=?").run(cost, draw.id);
          return { tickets: Number(mine) + count, pot: Number(draw.pot) + cost };
        });
        await safeReply(message, `🎟️ **${count}** ticket(s) acheté(s) pour **${format(cost)}**. Tu as **${result.tickets}/${LOTTERY_MAX_TICKETS}** tickets. Cagnotte : **${format(result.pot)}**.`);
      } else if (action === "draw" || action === "tirage") {
        if (!admin(message.member)) throw new Error("Seuls les administrateurs peuvent lancer le tirage.");
        const draw = openDraw();
        if (!draw) throw new Error("Aucun tirage en cours.");
        const tickets = db.prepare("SELECT user_id FROM lottery_tickets WHERE draw_id=?").all(draw.id);
        if (!tickets.length) throw new Error("Aucun ticket vendu pour ce tirage.");
        const winner = tickets[randomInt(tickets.length)].user_id;
        const payout = lotteryPayout(draw.pot);
        transaction(() => {
          db.prepare("UPDATE lottery_draws SET winner_id=? WHERE id=? AND winner_id IS NULL").run(winner, draw.id);
          changeBalance(gid, winner, payout, "lottery_win");
        });
        await safeReply(message, `🎉 Le tirage est terminé ! ${mention(winner)} remporte **${format(payout)}** sur une cagnotte de **${format(draw.pot)}**.`);
      } else {
        const draw = openDraw();
        const count = draw ? db.prepare("SELECT COUNT(*) AS count FROM lottery_tickets WHERE draw_id=?").get(draw.id).count : 0;
        await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("🎟️ Loterie PND").setDescription(draw
          ? `Cagnotte : **${format(draw.pot)}**\nTickets vendus : **${count}**\nPrix du ticket : **100 PND**\n\nAchète avec \`=lottery buy [1-10]\`.`
          : "Aucun tirage en cours. Achète un ticket avec `=lottery buy` pour lancer la cagnotte."))], allowedMentions: { parse: [] } });
      }
    } else if (command === "=pay") {
      const target = message.mentions.users.first();
      if (!target || target.bot || target.id === uid) throw new Error("Utilisation : `=pay @membre montant` (membre non-bot, différent de toi).");
      const amount = parseAmount(parts[2]);
      const joinedAt = Number(message.member?.joinedTimestamp ?? NaN);
      const senderBalance = transaction(() => {
        // Anti-fraud is evaluated inside the transaction so concurrent transfers cannot both pass the cap.
        const decision = evaluateTransfer({
          amount,
          accountCreatedAt: Number(message.author?.createdTimestamp ?? NaN),
          joinedAt,
          whitelisted: isWhitelistMember(message.member, guildSettings?.sysPlus?.whitelistRoleId ?? null),
          ...senderWindow(gid, uid),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        changeBalance(gid, uid, -amount, "transfer_sent");
        changeBalance(gid, target.id, amount, "transfer_received");
        recordTransfer({ guildId: gid, senderId: uid, recipientId: target.id, amount, senderJoinedAt: Number.isFinite(joinedAt) ? joinedAt : null });
        recordMissionProgress(gid, uid, "transfer");
        return balance(gid, uid);
      });
      await safeReply(message, `💸 ${mention(uid)} a envoyé **${format(amount)}** à ${mention(target.id)}. Solde restant : **${format(senderBalance)}**.`);
      for (const signal of detectTransferSignals({ guildId: gid, senderId: uid, recipientId: target.id })) {
        void sendCentralLog(message.guild, guildSettings, systemLogEmbed({ title: "🚩 Économie PND — transfert suspect", description: `${describeSignal(signal)}\nAucune sanction automatique : vérification humaine (\`/sysp diagnostic economie\`).`, color: 0xf59e0b })).catch(() => {});
      }
    } else if (command === "=pnd") {
      if (!isConfiguredPndOwner(uid, process.env.PND_OWNER_DISCORD_ID, gid)) throw new Error("Cette commande est réservée au propriétaire PND configuré.");
      const action = parts[1]?.toLowerCase(), target = message.mentions.users.first();
      const amount = parseAmount(parts[3], action === "set");
      if (!["add", "remove", "set"].includes(action) || !target || target.bot) throw new Error("Utilisation : `=pnd add|remove|set @membre montant`.");
      const total = transaction(() => {
        let newBalance;
        if (action === "set") {
          const current = balance(gid, target.id);
          changeBalance(gid, target.id, amount - current, "admin_set");
          newBalance = amount;
        } else {
          newBalance = changeBalance(gid, target.id, action === "add" ? amount : -amount, action === "add" ? "admin_add" : "admin_remove");
        }
        recordSysPlusAudit(gid, uid, `pnd.${action}`, target.id, { amount, balance: newBalance });
        return newBalance;
      });
      await safeReply(message, `✅ Solde de ${mention(target.id)} : **${format(total)}**.`);
    } else if (command === "=pnd-audit") {
      if (!isConfiguredPndOwner(uid, process.env.PND_OWNER_DISCORD_ID, gid)) throw new Error("Cette commande est réservée au propriétaire PND configuré.");
      const rows = listPndAdjustmentAudit(gid, 20);
      const lines = rows.map((row) => `• <t:${Math.floor(row.createdAt / 1000)}:R> — \`${row.action}\` par <@${row.actorId}> → <@${row.targetId}> · ${format(row.details?.amount ?? row.details?.balance ?? 0)}`);
      await message.reply({
        embeds: [brandEmbed(new EmbedBuilder().setTitle("🧾 Audit PND").setDescription(lines.join("\n") || "Aucun ajustement PND enregistré.").setFooter({ text: "Dernières 20 opérations propriétaire de ce serveur." }))],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=pnd-history") {
      if (!isConfiguredPndOwner(uid, process.env.PND_OWNER_DISCORD_ID, gid)) throw new Error("Cette commande est réservée au propriétaire PND configuré.");
      const target = message.mentions.users.first();
      const rows = target
        ? db.prepare("SELECT user_id,delta,reason,created_at FROM economy_ledger WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 20").all(gid, target.id)
        : db.prepare("SELECT user_id,delta,reason,created_at FROM economy_ledger WHERE guild_id=? ORDER BY id DESC LIMIT 20").all(gid);
      const lines = rows.map((row) => `• <t:${Math.floor(Number(row.created_at) / 1000)}:R> — <@${row.user_id}> · ${Number(row.delta) >= 0 ? "+" : ""}${format(Number(row.delta))} · \`${String(row.reason).slice(0, 60)}\``);
      await message.reply({
        embeds: [brandEmbed(new EmbedBuilder().setTitle("📜 Historique PND").setDescription(lines.join("\n") || "Aucune opération enregistrée.").setFooter({ text: target ? `Membre ${target.id} · 20 dernières opérations` : "Serveur · 20 dernières opérations" }))],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=shop") {
      if (parts[1]?.toLowerCase() === "add" || parts[1]?.toLowerCase() === "remove") {
        if (!admin(message.member)) throw new Error("Seuls les administrateurs peuvent gérer la boutique.");
        const role = getMentionedRole(message, parts[2]);
        const bot = await message.guild.members.fetchMe();
        if (!roleIsAssignable(role, bot)) throw new Error("Mentionne un rôle achetable situé sous le rôle du bot.");
        if (parts[1].toLowerCase() === "remove") {
          db.prepare("DELETE FROM shop_items WHERE guild_id=? AND role_id=?").run(gid, role.id);
          await safeReply(message, `🗑️ **${role.name}** retiré de la boutique.`);
        } else {
          const price = parseAmount(parts[3]);
          db.prepare("INSERT INTO shop_items(guild_id,role_id,price) VALUES(?,?,?) ON CONFLICT(guild_id,role_id) DO UPDATE SET price=excluded.price").run(gid, role.id, price);
          await safeReply(message, `✅ **${role.name}** ajouté à la boutique pour **${format(price)}**. Utilisation : =buy @${role.name}.`);
        }
      } else {
        const items = db.prepare("SELECT role_id,price FROM shop_items WHERE guild_id=? ORDER BY price ASC LIMIT 25").all(gid);
        if (!items.length) await safeReply(message, "🛍️ La boutique est vide. Un administrateur peut y ajouter des rôles avec `=shop add @Rôle prix`.");
        else {
          const lines = await Promise.all(items.map(async (item) => {
            const role = await message.guild.roles.fetch(item.role_id).catch(() => null);
            return role ? `• **${role.name}** — ${format(item.price)} — commande =buy @${role.name}` : null;
          }));
          await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("🛍️ Boutique PND").setDescription(lines.filter(Boolean).join("\n") || "Aucun rôle disponible."))], allowedMentions: { parse: [] } });
        }
      }
    } else if (command === "=buy") {
      const role = getMentionedRole(message, parts[1]);
      if (!role) throw new Error("Utilisation : `=buy @Rôle`.");
      const bot = await message.guild.members.fetchMe();
      if (!roleIsAssignable(role, bot)) throw new Error("Ce rôle ne peut pas être distribué par le bot.");
      const purchaseKey = `${gid}:${uid}:${role.id}`;
      if (purchaseLocks.has(purchaseKey)) throw new Error("Cet achat est déjà en cours.");
      purchaseLocks.add(purchaseKey);
      try {
        if (message.member.roles.cache.has(role.id)) throw new Error("Tu as déjà ce rôle.");
        const row = db.prepare("SELECT price FROM shop_items WHERE guild_id=? AND role_id=?").get(gid, role.id);
        if (!row) throw new Error("Ce rôle n’est pas dans la boutique.");
        const price = Number(row.price);
        transaction(() => changeBalance(gid, uid, -price, "shop_purchase"));
        try {
          await message.member.roles.add(role, `Achat boutique PND (${price})`);
        } catch {
          const refreshed = await message.guild.members.fetch({ user: uid, force: true }).catch(() => null);
          if (!refreshed?.roles.cache.has(role.id)) {
            transaction(() => changeBalance(gid, uid, price, "shop_refund"));
            throw new Error("Discord n’a pas pu donner le rôle ; le paiement a été remboursé.");
          }
        }
        transaction(() => recordMissionProgress(gid, uid, "shop"));
        await safeReply(message, `🎉 Tu as acheté **${role.name}** pour **${format(price)}**.`);
      } finally {
        purchaseLocks.delete(purchaseKey);
      }
    } else if (command === "=inventory") {
      const roles = [...message.member.roles.cache.values()].filter((role) => db.prepare("SELECT 1 FROM shop_items WHERE guild_id=? AND role_id=?").get(gid, role.id));
      await safeReply(message, roles.length ? `🎒 Tes rôles achetés : ${roles.map((role) => `**${role.name}**`).join(", ")}.` : "🎒 Ton inventaire de rôles achetés est vide.");
    } else if (command === "=market") {
      const action = (parts[1] ?? "list").toLowerCase();
      if (action === "sell") {
        const role = getMentionedRole(message, parts[2]);
        if (!role || !message.member.roles.cache.has(role.id)) throw new Error("Tu dois posséder le rôle que tu mets en vente.");
        const bot = await message.guild.members.fetchMe();
        if (!roleIsAssignable(role, bot)) throw new Error("Le bot ne peut pas transférer ce rôle en raison de sa hiérarchie.");
        const listingId = createMarketListing(gid, uid, role.id, parseAmount(parts[3]));
        await safeReply(message, `✅ Annonce **#${listingId}** publiée : **${role.name}** pour **${format(parseAmount(parts[3]))}**.`);
      } else if (action === "cancel") {
        cancelMarketListing(gid, uid, Number(parts[2]));
        await safeReply(message, `↩️ Annonce **#${parts[2]}** retirée.`);
      } else if (action === "buy") {
        const listingId = Number(parts[2]);
        const listing = await buyMarketListing(gid, uid, listingId, (transfer) => transferEconomyRole(message.guild, transfer));
        await safeReply(message, `🎉 Tu as acheté le rôle <@&${listing.role_id}> pour **${format(Number(listing.price))}**; le vendeur a été payé.`);
      } else {
        const listings = listMarketListings(gid);
        const lines = await Promise.all(listings.map(async (row) => {
          const role = await message.guild.roles.fetch(row.role_id).catch(() => null);
          return role ? `• **#${row.id} ${role.name}** — ${format(Number(row.price))} · vendeur <@${row.seller_id}> · /shop market buy` : null;
        }));
        await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("🛒 Marché PND").setDescription(lines.filter(Boolean).join("\n") || "Aucune annonce ouverte."))], allowedMentions: { parse: [] } });
      }
    } else if (command === "=auction") {
      const action = (parts[1] ?? "list").toLowerCase();
      if (action === "create") {
        const role = getMentionedRole(message, parts[2]);
        if (!role || !message.member.roles.cache.has(role.id)) throw new Error("Tu dois posséder le rôle que tu mets aux enchères.");
        const bot = await message.guild.members.fetchMe();
        if (!roleIsAssignable(role, bot)) throw new Error("Le bot ne peut pas transférer ce rôle en raison de sa hiérarchie.");
        const auctionId = createEconomyAuction(gid, uid, role.id, parseAmount(parts[3]), Number(parts[4]));
        await safeReply(message, `🔨 Enchère **#${auctionId}** ouverte pour **${role.name}**. Elle sera réglée automatiquement à l’échéance.`);
      } else if (action === "bid") {
        const result = placeEconomyAuctionBid(gid, uid, Number(parts[2]), parseAmount(parts[3]));
        await safeReply(message, `✅ Offre de **${format(result.amount)}** enregistrée en escrow jusqu’à l’échéance.`);
      } else if (action === "cancel") {
        cancelEconomyAuction(gid, uid, Number(parts[2]));
        await safeReply(message, `↩️ Enchère **#${parts[2]}** annulée.`);
      } else {
        const auctions = listEconomyAuctions(gid);
        const lines = await Promise.all(auctions.map(async (row) => {
          const role = await message.guild.roles.fetch(row.role_id).catch(() => null);
          const bid = Number(row.highest_bid) || Number(row.start_price);
          return role ? `• **#${row.id} ${role.name}** — offre minimale ${format(bid + (row.highest_bid ? 1 : 0))} · fin <t:${Math.floor(Number(row.ends_at) / 1000)}:R> · meilleur enchérisseur ${row.highest_bidder_id ? `<@${row.highest_bidder_id}>` : "aucun"}` : null;
        }));
        await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("🔨 Enchères PND").setDescription(lines.filter(Boolean).join("\n") || "Aucune enchère ouverte."))], allowedMentions: { parse: [] } });
      }
    } else if (command === "=leaderboard") {
      const leaders = db.prepare("SELECT user_id, balance + bank AS balance FROM wallets WHERE guild_id=? AND balance + bank > 0 ORDER BY balance DESC, user_id ASC LIMIT 10").all(gid);
      const lines = leaders.map((entry, index) => `**${index + 1}.** ${mention(entry.user_id)} — ${format(entry.balance)}`);
      await message.reply({ embeds: [brandEmbed(new EmbedBuilder().setTitle("🏆 Classement PND").setDescription(lines.length ? lines.join("\n") : "Aucun portefeuille positif pour le moment."))], allowedMentions: { parse: [] } });
    } else if (command === "=roulette") {
      const bet = parseAmount(parts[1]), choice = parts[2]?.toLowerCase();
      if (!["red", "black", "green", "rouge", "noir", "vert"].includes(choice)) throw new Error("Utilisation : `=roulette mise red|black|green`.");
      const normalized = ({ rouge: "red", noir: "black", vert: "green" })[choice] ?? choice;
      const spin = randomInt(37), color = spin === 0 ? "green" : RED.has(spin) ? "red" : "black";
      const winnings = color === normalized ? bet * (color === "green" ? 36 : 2) : 0;
      const total = transaction(() => { assertCasinoCanStart({ guildId: gid, userId: uid, bet }); changeBalance(gid, uid, -bet, "roulette_bet"); if (winnings) changeBalance(gid, uid, winnings, "roulette_payout"); return balance(gid, uid); });
      await safeReply(message, `🎡 La bille tombe sur **${spin} ${color}**. ${winnings ? `Tu gagnes **${format(winnings)}** !` : `Tu perds **${format(bet)}**.`} Solde : **${format(total)}**.`);
    } else if (command === "=blackjack") {
      const bet = parseAmount(parts[1]);
      const previousGame = db.prepare("SELECT * FROM active_blackjack WHERE guild_id=? AND user_id=?").get(gid, uid);
      if (previousGame && Date.now() - Number(previousGame.created_at) <= 15 * 60_000) throw new Error("Tu as déjà une partie en cours.");
      if (previousGame) transaction(() => {
        changeBalance(gid, uid, Number(previousGame.bet), "blackjack_timeout_refund");
        db.prepare("DELETE FROM active_blackjack WHERE game_id=?").run(previousGame.game_id);
      });
      const gameId = randomUUID().replaceAll("-", "").slice(0, 20);
      const game = { gameId, guildId: gid, userId: uid, bet, playerCards: [drawCard(), drawCard()], dealerCards: [drawCard(), drawCard()] };
      transaction(() => {
        assertCasinoCanStart({ guildId: gid, userId: uid, bet });
        changeBalance(gid, uid, -bet, "blackjack_bet");
        db.prepare("INSERT INTO active_blackjack(game_id,guild_id,user_id,bet,player_cards,dealer_cards,created_at) VALUES(?,?,?,?,?,?,?)").run(gameId, gid, uid, bet, JSON.stringify(game.playerCards), JSON.stringify(game.dealerCards), Date.now());
      });
      if (handValue(game.playerCards) === 21) {
        settleGame(game, "blackjack");
        await message.reply({ embeds: [blackjackEmbed(game, true, `Blackjack ! Tu gagnes **${format(Math.floor(bet * 1.5))}** de bénéfice.`)], allowedMentions: { parse: [] } });
      } else {
        await message.reply({ embeds: [blackjackEmbed(game)], components: blackjackButtons(gameId), allowedMentions: { parse: [] } });
      }
    }
  } catch (error) {
    await safeReply(message, `❌ ${error.message}`).catch(() => {});
  }
  return true;
}

export async function handleEconomyInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("economy:bj:")) return false;
  const [, , gameId, action] = interaction.customId.split(":");
  const row = db.prepare("SELECT * FROM active_blackjack WHERE game_id=?").get(gameId);
  if (!row) { await interaction.reply({ content: "Cette partie a expiré ou a déjà été réglée.", ephemeral: true }); return true; }
  if (interaction.user.id !== row.user_id || interaction.guildId !== row.guild_id) {
    await interaction.reply({ content: "Seule la personne qui a lancé cette partie peut jouer.", ephemeral: true });
    return true;
  }
  if (Date.now() - Number(row.created_at) > 15 * 60_000) {
    await interaction.deferUpdate();
    const refunded = transaction(() => {
      if (!db.prepare("SELECT 1 FROM active_blackjack WHERE game_id=?").get(gameId)) return false;
      changeBalance(row.guild_id, row.user_id, Number(row.bet), "blackjack_timeout_refund");
      db.prepare("DELETE FROM active_blackjack WHERE game_id=?").run(gameId);
      return true;
    });
    await interaction.editReply({ content: refunded ? `⌛ La partie a expiré. Ta mise de ${format(row.bet)} a été rendue.` : "Cette partie a déjà été réglée.", components: [], embeds: [], allowedMentions: { parse: [] } });
    return true;
  }
  if (activeGameActions.has(gameId)) {
    await interaction.reply({ content: "Cette action est déjà en cours.", ephemeral: true });
    return true;
  }
  activeGameActions.add(gameId);
  try {
  await interaction.deferUpdate();
  const game = {
    gameId, guildId: row.guild_id, userId: row.user_id, bet: Number(row.bet),
    playerCards: JSON.parse(row.player_cards), dealerCards: JSON.parse(row.dealer_cards),
  };
  let result = "À toi de jouer.", done = false, outcome = null;
  if (action === "hit") {
    game.playerCards.push(drawCard());
    const value = handValue(game.playerCards);
    if (value > 21) { done = true; outcome = "loss"; result = `Tu dépasses 21 (**${value}**). Tu perds **${format(game.bet)}**.`; }
  } else if (action === "stand") {
    while (handValue(game.dealerCards) < 17) game.dealerCards.push(drawCard());
    const player = handValue(game.playerCards), dealer = handValue(game.dealerCards);
    if (dealer > 21 || player > dealer) { done = true; outcome = "win"; result = `Tu gagnes ! Bénéfice : **${format(game.bet)}**.`; }
    else if (player === dealer) { done = true; outcome = "push"; result = `Égalité : ta mise de **${format(game.bet)}** est rendue.`; }
    else { done = true; outcome = "loss"; result = `Le croupier gagne (${dealer}). Tu perds **${format(game.bet)}**.`; }
  } else {
    await interaction.editReply({ content: "Action inconnue.", components: [] });
    return true;
  }
  if (!done && handValue(game.playerCards) === 21) {
    while (handValue(game.dealerCards) < 17) game.dealerCards.push(drawCard());
    const dealer = handValue(game.dealerCards);
    if (dealer < 21) { done = true; outcome = "win"; result = `21 ! Tu gagnes **${format(game.bet)}**.`; }
    else if (dealer === 21) { done = true; outcome = "push"; result = "Égalité à 21 : ta mise est rendue."; }
  }
  if (done) settleGame(game, outcome);
  else db.prepare("UPDATE active_blackjack SET player_cards=?,dealer_cards=? WHERE game_id=?").run(JSON.stringify(game.playerCards), JSON.stringify(game.dealerCards), gameId);
  await interaction.editReply({ embeds: [blackjackEmbed(game, done, result)], components: blackjackButtons(gameId, done), allowedMentions: { parse: [] } });
  } finally {
    activeGameActions.delete(gameId);
  }
  return true;
}

function addReconciliationReview(guildId, kind, refId, reason, now) {
  db.prepare(`INSERT INTO economy_reconciliation_reviews(guild_id,kind,ref_id,reason,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(kind,ref_id) DO NOTHING`).run(guildId, kind, refId, reason, now);
}

export function listReconciliationReviews(guildId, limit = 15) {
  return db.prepare("SELECT kind,ref_id,reason,created_at FROM economy_reconciliation_reviews WHERE guild_id=? AND resolved=0 ORDER BY created_at DESC LIMIT ?")
    .all(guildId, Math.max(1, Math.min(50, limit)));
}

/**
 * Reconciles market purchases and auctions left "pending" by a crash between
 * the Discord role transfer and the PND settlement. The decision relies on
 * the actual role ownership read from Discord:
 * - transfer done (buyer has the role, seller not) → settle the payment;
 * - transfer not done (seller has it, buyer not) → reopen / let the worker retry;
 * - anything else (both, neither, unknown buyer) → kept pending + review row.
 * Never pays twice: every settlement is a conditional status update inside
 * the same transaction as the balance changes. Unreadable Discord state is skipped.
 */
export async function reconcilePendingEconomy({ inspectRoles, transferRole = null, now = Date.now(), minAgeMs = 5 * 60_000 } = {}) {
  if (typeof inspectRoles !== "function") throw new Error("Lecture des rôles indisponible.");
  const result = { settled: 0, reopened: 0, review: 0, skipped: 0 };
  const listings = db.prepare("SELECT * FROM economy_market_listings WHERE status='pending' AND updated_at<=? ORDER BY id LIMIT 50").all(now - minAgeMs);
  for (const listing of listings) {
    if (marketLocks.has(`${listing.guild_id}:${listing.id}`)) { result.skipped++; continue; }
    if (!listing.buyer_id) {
      addReconciliationReview(listing.guild_id, "market", listing.id, "Achat en attente sans acheteur enregistré (ancienne version).", now);
      result.review++;
      continue;
    }
    const state = await inspectRoles(listing.guild_id, { sellerId: listing.seller_id, buyerId: listing.buyer_id, roleId: listing.role_id }).catch(() => null);
    if (!state) { result.skipped++; continue; }
    if (state.buyerHas && !state.sellerHas) {
      try {
        transaction(() => {
          const settled = db.prepare("UPDATE economy_market_listings SET status='sold',updated_at=? WHERE id=? AND status='pending'").run(now, listing.id);
          if (!Number(settled.changes)) throw new Error("already settled");
          changeBalance(listing.guild_id, listing.buyer_id, -Number(listing.price), "market_purchase_reconciled");
          changeBalance(listing.guild_id, listing.seller_id, Number(listing.price), "market_sale_reconciled");
        });
        result.settled++;
      } catch {
        let reversed = false;
        if (transferRole) {
          try {
            await transferRole({ guildId: listing.guild_id, sellerId: listing.seller_id, buyerId: listing.buyer_id, roleId: listing.role_id, reverse: true });
            reversed = true;
          } catch { /* fall through to review */ }
        }
        if (reversed) {
          db.prepare("UPDATE economy_market_listings SET status='open',buyer_id=NULL,updated_at=? WHERE id=? AND status='pending'").run(now, listing.id);
          result.reopened++;
        } else {
          addReconciliationReview(listing.guild_id, "market", listing.id, "Rôle transféré mais paiement impossible (solde insuffisant ?) et retour du rôle impossible.", now);
          result.review++;
        }
      }
    } else if (state.sellerHas && !state.buyerHas) {
      db.prepare("UPDATE economy_market_listings SET status='open',buyer_id=NULL,updated_at=? WHERE id=? AND status='pending'").run(now, listing.id);
      result.reopened++;
    } else {
      addReconciliationReview(listing.guild_id, "market", listing.id, `Possession du rôle ambiguë (vendeur ${state.sellerHas ? "oui" : "non"}, acheteur ${state.buyerHas ? "oui" : "non"}).`, now);
      result.review++;
    }
  }

  const auctions = db.prepare("SELECT * FROM economy_auctions WHERE status='pending' AND updated_at<=? ORDER BY id LIMIT 50").all(now - minAgeMs);
  for (const auction of auctions) {
    const state = await inspectRoles(auction.guild_id, { sellerId: auction.seller_id, buyerId: auction.highest_bidder_id, roleId: auction.role_id }).catch(() => null);
    if (!state) { result.skipped++; continue; }
    if (state.buyerHas && !state.sellerHas) {
      // Escrow already holds the bid: only the seller payment is missing.
      const paid = transaction(() => {
        const sold = db.prepare("UPDATE economy_auctions SET status='sold',updated_at=? WHERE id=? AND status='pending'").run(now, auction.id);
        if (!Number(sold.changes)) return false;
        changeBalance(auction.guild_id, auction.seller_id, Number(auction.highest_bid), "auction_sale_reconciled");
        return true;
      });
      if (paid) result.settled++;
    } else if (state.sellerHas && !state.buyerHas) {
      // Nothing moved: hand the auction back to the settlement worker.
      db.prepare("UPDATE economy_auctions SET status='open',updated_at=? WHERE id=? AND status='pending'").run(now, auction.id);
      result.reopened++;
    } else {
      addReconciliationReview(auction.guild_id, "auction", auction.id, `Possession du rôle ambiguë (vendeur ${state.sellerHas ? "oui" : "non"}, gagnant ${state.buyerHas ? "oui" : "non"}). Escrow conservé.`, now);
      result.review++;
    }
  }
  return result;
}
