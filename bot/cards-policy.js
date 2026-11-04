// Her? V4 — règles de cartes pures (packs, rareté, échanges).
import { CARDS_BY_ID, RARITIES, cardsByRarity } from "./cards-data.js";

export const PACK_SIZE = 3;
export const PACK_COST = 250;
export const DUPLICATE_REFUND = 50;
export const TRADE_TTL_MS = 10 * 60_000;
export const MAX_TRADE_CARDS = 5;

/** Convertit un tirage 0..1 en rareté selon les poids cumulés. */
export function rarityForRoll(roll) {
  const value = Math.min(0.999999, Math.max(0, Number(roll) || 0)) * 100;
  let cumulative = 0;
  for (const [key, rarity] of Object.entries(RARITIES)) {
    cumulative += rarity.weight;
    if (value < cumulative) return key;
  }
  return "common";
}

/** Sélectionne une carte d’une rareté donnée (index borné). */
export function cardForRarity(rarity, index = 0) {
  const pool = cardsByRarity(rarity);
  if (!pool.length) return cardsByRarity("common")[0];
  const position = Math.min(pool.length - 1, Math.max(0, Math.floor(Number(index) || 0)));
  return pool[position];
}

export function packValue(cards) {
  return cards.reduce((total, card) => total + (RARITIES[card.rarity]?.value ?? 0), 0);
}

export function collectionValue(rows) {
  return rows.reduce((total, row) => {
    const card = CARDS_BY_ID.get(row.card_id);
    return total + (card ? (RARITIES[card.rarity]?.value ?? 0) * Number(row.quantity) : 0);
  }, 0);
}

export function normalizeCardId(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
}

export function tradeIsValid({ trade, traderId, now = Date.now() }) {
  if (!trade) return { allowed: false, reason: "Échange introuvable." };
  if (trade.status !== "pending") return { allowed: false, reason: "Cet échange n’est plus en attente." };
  if (Number(trade.expires_at) <= now) return { allowed: false, reason: "Cet échange a expiré." };
  if (trade.to_id !== traderId) return { allowed: false, reason: "Cet échange ne t’est pas destiné." };
  return { allowed: true, reason: null };
}
