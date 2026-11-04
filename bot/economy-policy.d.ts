export const WORK_MIN: number;
export const WORK_MAX: number;
export const LOTTERY_TICKET_PRICE: number;
export const LOTTERY_MAX_TICKETS: number;
export function workReward(random?: number): number;
export function robPlan(input: { victimBalance: number; ownBalance?: number; roll?: number; successRate?: number }): {
  allowed: boolean; reason: string | null; success: boolean; amount: number; fine: number;
};
export function ticketCost(count: number): { tickets: number; cost: number };
export function lotteryPayout(pot: number): number;
