import type { Rarity } from "./cards-data.js";
export const PACK_SIZE: number;
export const PACK_COST: number;
export const DUPLICATE_REFUND: number;
export const TRADE_TTL_MS: number;
export const MAX_TRADE_CARDS: number;
export function rarityForRoll(roll: number): Rarity;
export function cardForRarity(rarity: Rarity, index?: number): { id: string; name: string; rarity: Rarity; emoji: string };
export function packValue(cards: { rarity: Rarity }[]): number;
export function collectionValue(rows: { card_id: string; quantity: number }[]): number;
export function normalizeCardId(raw: unknown): string;
export function tradeIsValid(input: {
  trade: { status: string; to_id: string; expires_at: number } | null | undefined;
  traderId: string;
  now?: number;
}): { allowed: boolean; reason: string | null };
