// Shared 52-card helpers for the card games of the PND Casino.
// Cards are two-character strings: rank (A23456789TJQK) + suit (shdc).
export const RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]);
export const SUITS = Object.freeze(["s", "h", "d", "c"]);
const SUIT_EMOJI = { s: "♠️", h: "♥️", d: "♦️", c: "♣️" };

export const cardLabel = (card) => `\`${card[0] === "T" ? "10" : card[0]}\`${SUIT_EMOJI[card[1]] ?? "?"}`;
export const handLabel = (cards) => cards.map(cardLabel).join(" ");
export const hiddenCard = () => "`?`🂠";

export function createShoe(decks = 6) {
  if (!Number.isInteger(decks) || decks < 1 || decks > 8) throw new Error("Nombre de jeux invalide.");
  const shoe = [];
  for (let d = 0; d < decks; d += 1) for (const rank of RANKS) for (const suit of SUITS) shoe.push(rank + suit);
  return shoe;
}

/** Fisher-Yates. `rng(n)` must return an integer in [0, n). */
export function shuffle(cards, rng) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const cardValue = (card) => (card[0] === "A" ? 11 : "TJQK".includes(card[0]) ? 10 : Number(card[0]));

/** Best blackjack total; `soft` means an ace is still counted as 11. */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card[0] === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0, busted: total > 21 };
}

export const isNaturalBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
