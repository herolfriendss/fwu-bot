import { describe, expect, it } from "vitest";
import { CARDS, CARDS_BY_ID, RARITIES, cardsByRarity } from "../../bot/cards-data.js";
import {
  collectionValue, normalizeCardId, packValue, rarityForRoll, tradeIsValid,
} from "../../bot/cards-policy.js";

describe("card collection", () => {
  it("has unique ids and a balanced catalogue", () => {
    expect(new Set(CARDS.map((card) => card.id)).size).toBe(CARDS.length);
    expect(CARDS_BY_ID.size).toBe(CARDS.length);
    for (const rarity of Object.keys(RARITIES)) expect(cardsByRarity(rarity as keyof typeof RARITIES).length).toBeGreaterThan(0);
  });

  it("maps weighted rolls to the expected rarity", () => {
    expect(rarityForRoll(0)).toBe("common");
    expect(rarityForRoll(0.599)).toBe("common");
    expect(rarityForRoll(0.6)).toBe("uncommon");
    expect(rarityForRoll(0.85)).toBe("rare");
    expect(rarityForRoll(0.95)).toBe("epic");
    expect(rarityForRoll(0.99)).toBe("legendary");
    expect(rarityForRoll(1)).toBe("legendary");
  });

  it("normalizes card ids and computes collection value", () => {
    expect(normalizeCardId("  Dragon!! ")).toBe("dragon");
    expect(normalizeCardId("étoile")).toBe("toile");
    expect(collectionValue([{ card_id: "dragon", quantity: 2 }, { card_id: "chien", quantity: 1 }]))
      .toBe(RARITIES.rare.value * 2 + RARITIES.common.value);
    expect(packValue([CARDS_BY_ID.get("chien")!])).toBe(RARITIES.common.value);
  });

  it("validates only pending, unexpired trades addressed to the member", () => {
    const now = Date.UTC(2026, 10, 4);
    const trade = { status: "pending", to_id: "222222222222222222", expires_at: now + 1_000 };
    expect(tradeIsValid({ trade, traderId: "222222222222222222", now })).toEqual({ allowed: true, reason: null });
    expect(tradeIsValid({ trade, traderId: "333333333333333333", now }).allowed).toBe(false);
    expect(tradeIsValid({ trade: { ...trade, expires_at: now }, traderId: "222222222222222222", now }).allowed).toBe(false);
    expect(tradeIsValid({ trade: { ...trade, status: "completed" }, traderId: "222222222222222222", now }).allowed).toBe(false);
  });
});
