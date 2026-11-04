export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITIES: Record<Rarity, { label: string; weight: number; value: number; color: number }>;
export type Card = { id: string; name: string; rarity: Rarity; emoji: string };
export const CARDS: Card[];
export const CARDS_BY_ID: Map<string, Card>;
export function cardsByRarity(rarity: Rarity): Card[];
