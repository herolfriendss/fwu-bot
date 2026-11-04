import { describe, expect, it } from "vitest";
import {
  autoRolePlan, clampInterval, isDue, nextRunAt, renderAutomation, sanitizeAutomationContent,
} from "../../bot/automation-policy.js";

describe("automation policy", () => {
  it("clamps intervals between five minutes and one week", () => {
    expect(clampInterval(0)).toBe(5);
    expect(clampInterval(10)).toBe(10);
    expect(clampInterval(99_999)).toBe(10_080);
    expect(clampInterval("abc")).toBe(5);
  });

  it("renders placeholders and trims content", () => {
    expect(renderAutomation("Bienvenue {user} sur {server} !", { user: "Ryan", server: "Her?" })).toBe("Bienvenue Ryan sur Her? !");
    expect(renderAutomation("{user}".repeat(500)).length).toBeLessThanOrEqual(2_000);
    expect(sanitizeAutomationContent("  ligne 1\r\nligne 2  ")).toBe("ligne 1\nligne 2");
    expect(sanitizeAutomationContent("x".repeat(3_000))).toHaveLength(2_000);
  });

  it("computes due dates from the interval", () => {
    const now = Date.UTC(2026, 10, 4, 12, 0, 0);
    expect(nextRunAt(now, 5)).toBe(now + 5 * 60_000);
    expect(isDue(now, now)).toBe(true);
    expect(isDue(now + 1, now)).toBe(false);
    expect(isDue("bad", now)).toBe(false);
  });

  it("plans only roles below the bot and not already held", () => {
    const plan = autoRolePlan(["1", "2", "3", "1"], {
      botPosition: 10,
      rolePositions: { 1: 5, 2: 12, 3: 9 },
      memberRoleIds: ["3"],
    });
    expect(plan.applicable).toEqual(["1"]);
    expect(plan.skipped).toEqual([{ roleId: "2", reason: "hierarchy" }]);
    expect(autoRolePlan(["999"], { botPosition: 10, rolePositions: {} }).skipped).toEqual([{ roleId: "999", reason: "missing" }]);
  });
});
