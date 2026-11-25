import { describe, expect, it } from "vitest";
import { BOT_PROFILES, BOT_PROFILE_IDS } from "@/lib/bot-profiles";

describe("FWU bot profiles", () => {
  it("keeps the five core bots required and Invest+ explicitly optional", () => {
    expect(BOT_PROFILE_IDS).toEqual([
      "fwu",
      "guard",
      "fdpdlavoc",
      "suckme",
      "fisc",
      "investplus",
    ]);

    for (const id of ["fwu", "guard", "fdpdlavoc", "suckme", "fisc"] as const) {
      expect(BOT_PROFILES[id].optional ?? false).toBe(false);
    }

    expect(BOT_PROFILES.investplus.optional).toBe(true);
    expect(BOT_PROFILES.investplus.label).toBe("Invest +");
  });
});
