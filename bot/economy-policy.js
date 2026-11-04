// Her? V4 — calculs économiques purs (aucune base, aucun Discord).
// Ces fonctions sont partagées par les gestionnaires et les tests.

export const WORK_MIN = 50;
export const WORK_MAX = 150;
export const LOTTERY_TICKET_PRICE = 100;
export const LOTTERY_MAX_TICKETS = 10;

export function workReward(random = Math.random()) {
  const clamped = Math.min(0.999999, Math.max(0, Number(random) || 0));
  return WORK_MIN + Math.floor(clamped * (WORK_MAX - WORK_MIN + 1));
}

export function robPlan({ victimBalance, ownBalance = 0, roll = Math.random(), successRate = 0.45 }) {
  const balance = Math.max(0, Math.floor(Number(victimBalance) || 0));
  if (balance < 50) return { allowed: false, reason: "victim_too_poor", success: false, amount: 0, fine: 0 };
  const success = Math.min(0.999999, Math.max(0, Number(roll) || 0)) < successRate;
  const amount = Math.min(500, Math.max(10, Math.floor(balance * 0.15)));
  return {
    allowed: true,
    reason: null,
    success,
    amount: success ? amount : 0,
    fine: success ? 0 : Math.min(100, Math.max(0, Math.floor(Number(ownBalance) || 0))),
  };
}

export function ticketCost(count) {
  const tickets = Math.min(LOTTERY_MAX_TICKETS, Math.max(1, Math.floor(Number(count) || 1)));
  return { tickets, cost: tickets * LOTTERY_TICKET_PRICE };
}

export function lotteryPayout(pot) {
  return Math.max(0, Math.floor((Number(pot) || 0) * 0.9));
}
