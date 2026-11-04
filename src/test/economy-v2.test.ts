import { describe, expect, it } from "vitest";
import { lotteryPayout, robPlan, ticketCost, workReward } from "../../bot/economy-policy.js";

describe("economy V2 policy", () => {
  it("keeps work rewards inside the advertised band", () => {
    expect(workReward(0)).toBe(50);
    expect(workReward(0.999999)).toBe(150);
    expect(workReward(-5)).toBe(50);
    expect(workReward(Number.NaN)).toBe(50);
  });

  it("refuses robbery below the minimum victim balance", () => {
    expect(robPlan({ victimBalance: 49, roll: 0 })).toMatchObject({ allowed: false, success: false });
  });

  it("caps stolen amounts and computes the failure fine", () => {
    expect(robPlan({ victimBalance: 100, ownBalance: 30, roll: 0 })).toMatchObject({ allowed: true, success: true, amount: 15, fine: 0 });
    expect(robPlan({ victimBalance: 100_000, ownBalance: 30, roll: 0.9 })).toMatchObject({ success: false, amount: 0, fine: 30 });
    expect(robPlan({ victimBalance: 100_000, ownBalance: 1_000, roll: 0 })).toMatchObject({ success: true, amount: 500 });
  });

  it("prices lottery tickets and caps a single purchase at ten", () => {
    expect(ticketCost(1)).toEqual({ tickets: 1, cost: 100 });
    expect(ticketCost(4)).toEqual({ tickets: 4, cost: 400 });
    expect(ticketCost(99)).toEqual({ tickets: 10, cost: 1_000 });
    expect(ticketCost(0)).toEqual({ tickets: 1, cost: 100 });
    expect(lotteryPayout(1_000)).toBe(900);
    expect(lotteryPayout(0)).toBe(0);
  });
});
