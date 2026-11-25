// Full blackjack: 6-deck shoe, double, split up to 4 hands, insurance, surrender.
// Dealer stands on all 17 (S17). Naturals pay 3:2. Every function here is pure:
// the state is a plain object the caller persists between button presses.
import { createShoe, shuffle, handValue, isNaturalBlackjack } from "./cards.js";

export const MAX_HANDS = 4;
const RESHUFFLE_BELOW = 20;

const draw = (state) => {
  if (state.shoe.length <= RESHUFFLE_BELOW) throw new Error("Sabot épuisé.");
  return state.shoe.pop();
};

/** Deals the opening hands. Phase is already "dealer" when a natural ends the round at once. */
export function newBlackjackGame({ bet, decks = 6, rng }) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new Error("Mise invalide.");
  const shoe = shuffle(createShoe(decks), rng);
  const state = {
    shoe,
    dealer: [],
    hands: [{ cards: [], bet, doubled: false, done: false, surrendered: false, fromSplit: false }],
    active: 0,
    insurance: 0,
    phase: "player",
  };
  state.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));
  state.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));
  if (isNaturalBlackjack(state.hands[0].cards) || isNaturalBlackjack(state.dealer)) {
    state.hands[0].done = true;
    state.phase = "dealer";
  }
  return state;
}

export const dealerUpcard = (state) => state.dealer[0];
export const insuranceOffered = (state) =>
  state.phase === "player" && state.insurance === 0 && dealerUpcard(state)?.[0] === "A"
  && state.hands.length === 1 && state.hands[0].cards.length === 2;

/** Which buttons the active hand may use right now. */
export function blackjackActions(state) {
  if (state.phase !== "player") return [];
  const hand = state.hands[state.active];
  if (!hand || hand.done) return [];
  const actions = ["hit", "stand"];
  const first = hand.cards.length === 2;
  if (first && !hand.fromSplit) actions.push("double", "surrender");
  else if (first) actions.push("double");
  if (first && state.hands.length < MAX_HANDS && hand.cards[0][0] === hand.cards[1][0]) actions.push("split");
  if (insuranceOffered(state)) actions.push("insurance");
  return actions;
}

function advance(state) {
  while (state.active < state.hands.length && state.hands[state.active].done) state.active += 1;
  if (state.active >= state.hands.length) {
    state.active = state.hands.length - 1;
    state.phase = "dealer";
  }
  return state;
}

/** Applies one player action. Returns the new state and the extra stake the caller must debit. */
export function blackjackAct(state, action, rng) {
  if (state.phase !== "player") throw new Error("La partie n'attend plus d'action.");
  if (!blackjackActions(state).includes(action)) throw new Error("Action impossible sur cette main.");
  const next = structuredClone(state);
  const hand = next.hands[next.active];
  let extraStake = 0;

  if (action === "hit") {
    hand.cards.push(draw(next));
    if (handValue(hand.cards).total >= 21) hand.done = true;
  } else if (action === "stand") {
    hand.done = true;
  } else if (action === "double") {
    extraStake = hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(draw(next));
    hand.done = true;
  } else if (action === "surrender") {
    hand.surrendered = true;
    hand.done = true;
  } else if (action === "insurance") {
    next.insurance = Math.floor(hand.bet / 2);
    return Object.assign(next, { extraStake: next.insurance }); // insurance does not end the hand
  } else if (action === "split") {
    const moved = hand.cards.pop();
    const isAces = hand.cards[0][0] === "A";
    hand.fromSplit = true;
    const created = { cards: [moved], bet: hand.bet, doubled: false, done: false, surrendered: false, fromSplit: true };
    extraStake = hand.bet;
    hand.cards.push(draw(next));
    created.cards.push(draw(next));
    if (isAces) {
      hand.done = true;
      created.done = true;
    }
    next.hands.splice(next.active + 1, 0, created);
    if (handValue(hand.cards).total >= 21) hand.done = true;
  }
  advance(next);
  return Object.assign(next, { extraStake });
}

/** Dealer draws to 17 and stands on every 17. */
export function blackjackDealerPlay(state) {
  const next = structuredClone(state);
  next.phase = "done";
  const playerStillIn = next.hands.some((h) => !h.surrendered && !handValue(h.cards).busted);
  const dealerNatural = isNaturalBlackjack(next.dealer);
  if (!playerStillIn || dealerNatural) return next;
  if (next.hands.every((h) => isNaturalBlackjack(h.cards) && !h.fromSplit)) return next;
  while (handValue(next.dealer).total < 17) next.dealer.push(draw(next));
  return next;
}

/** Gross returns, stake included. 0 means the stake is lost. */
export function blackjackSettle(state) {
  const dealer = handValue(state.dealer);
  const dealerNatural = isNaturalBlackjack(state.dealer);
  const hands = state.hands.map((hand) => {
    const value = handValue(hand.cards);
    const natural = isNaturalBlackjack(hand.cards) && !hand.fromSplit;
    if (hand.surrendered) return { result: "surrender", label: "Abandon", payout: Math.floor(hand.bet / 2), bet: hand.bet };
    if (value.busted) return { result: "bust", label: "Sauté", payout: 0, bet: hand.bet };
    if (natural && dealerNatural) return { result: "push", label: "Égalité (deux blackjacks)", payout: hand.bet, bet: hand.bet };
    if (natural) return { result: "blackjack", label: "Blackjack !", payout: hand.bet + Math.floor((hand.bet * 3) / 2), bet: hand.bet };
    if (dealerNatural) return { result: "lose", label: "Blackjack du croupier", payout: 0, bet: hand.bet };
    if (dealer.busted) return { result: "win", label: "Le croupier saute", payout: hand.bet * 2, bet: hand.bet };
    if (value.total > dealer.total) return { result: "win", label: "Gagné", payout: hand.bet * 2, bet: hand.bet };
    if (value.total === dealer.total) return { result: "push", label: "Égalité", payout: hand.bet, bet: hand.bet };
    return { result: "lose", label: "Perdu", payout: 0, bet: hand.bet };
  });
  const insurancePayout = state.insurance && dealerNatural ? state.insurance * 3 : 0;
  const totalBet = hands.reduce((sum, h) => sum + h.bet, 0) + state.insurance;
  const totalPayout = hands.reduce((sum, h) => sum + h.payout, 0) + insurancePayout;
  return { hands, insurancePayout, insuranceBet: state.insurance, totalBet, totalPayout, net: totalPayout - totalBet, dealerTotal: dealer.total, dealerNatural };
}
