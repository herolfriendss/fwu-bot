// Her? V4 — catalogue de cartes (données pures, aucun secret).
export const RARITIES = {
  common: { label: "Commune", weight: 60, value: 50, color: 0x9ca3af },
  uncommon: { label: "Peu commune", weight: 25, value: 120, color: 0x22c55e },
  rare: { label: "Rare", weight: 10, value: 300, color: 0x3b82f6 },
  epic: { label: "Épique", weight: 4, value: 800, color: 0xa855f7 },
  legendary: { label: "Légendaire", weight: 1, value: 2500, color: 0xf59e0b },
};

export const CARDS = [
  { id: "chien", name: "Chien fidèle", rarity: "common", emoji: "🐶" },
  { id: "chat", name: "Chat curieux", rarity: "common", emoji: "🐱" },
  { id: "lapin", name: "Lapin rapide", rarity: "common", emoji: "🐰" },
  { id: "renard", name: "Renard rusé", rarity: "common", emoji: "🦊" },
  { id: "panda", name: "Panda paisible", rarity: "common", emoji: "🐼" },
  { id: "koala", name: "Koala dormeur", rarity: "common", emoji: "🐨" },
  { id: "grenouille", name: "Grenouille verte", rarity: "common", emoji: "🐸" },
  { id: "hibou", name: "Hibou nocturne", rarity: "common", emoji: "🦉" },
  { id: "loup", name: "Loup solitaire", rarity: "uncommon", emoji: "🐺" },
  { id: "aigle", name: "Aigle royal", rarity: "uncommon", emoji: "🦅" },
  { id: "requin", name: "Requin des mers", rarity: "uncommon", emoji: "🦈" },
  { id: "panthere", name: "Panthère noire", rarity: "uncommon", emoji: "🐆" },
  { id: "dragon", name: "Dragon ancien", rarity: "rare", emoji: "🐉" },
  { id: "phenix", name: "Phénix flamboyant", rarity: "rare", emoji: "🔥" },
  { id: "licorne", name: "Licorne céleste", rarity: "rare", emoji: "🦄" },
  { id: "griffon", name: "Griffon noble", rarity: "rare", emoji: "🦁" },
  { id: "kraken", name: "Kraken abyssal", rarity: "epic", emoji: "🐙" },
  { id: "spectre", name: "Spectre du vide", rarity: "epic", emoji: "👻" },
  { id: "oracle", name: "Oracle éternel", rarity: "legendary", emoji: "🔮" },
  { id: "eternite", name: "Éternité", rarity: "legendary", emoji: "💎" },
];

export const CARDS_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

export function cardsByRarity(rarity) {
  return CARDS.filter((card) => card.rarity === rarity);
}
