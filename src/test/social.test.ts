import { describe, expect, it } from "vitest";
import {
  canGiveRep, colorToInt, repBadge, repCooldownRemaining, sanitizeBio, sanitizeProfileColor,
} from "../../bot/social-policy.js";

describe("social policy", () => {
  it("normalizes biographies and enforces the length limit", () => {
    expect(sanitizeBio("  Salut\n\n tout   le monde  ")).toBe("Salut tout le monde");
    expect(sanitizeBio("x".repeat(500))).toHaveLength(280);
  });

  it("accepts only valid profile colors", () => {
    expect(sanitizeProfileColor("#ABCDEF")).toBe("#abcdef");
    expect(sanitizeProfileColor("abc")).toBe("#aabbcc");
    expect(sanitizeProfileColor("red")).toBeNull();
    expect(colorToInt("#5865f2")).toBe(0x5865f2);
    expect(colorToInt("nope")).toBeNull();
  });

  it("blocks self-reputation and bots", () => {
    expect(canGiveRep({ giverId: "1", targetId: "1" }).allowed).toBe(false);
    expect(canGiveRep({ giverId: "1", targetId: "2", targetIsBot: true }).allowed).toBe(false);
    expect(canGiveRep({ giverId: "1", targetId: "2" })).toEqual({ allowed: true, reason: null });
  });

  it("computes the 24-hour reputation cooldown", () => {
    const now = Date.UTC(2026, 10, 4);
    expect(repCooldownRemaining(now - 3_600_000, now)).toBe(23 * 3_600_000);
    expect(repCooldownRemaining(now - 25 * 3_600_000, now)).toBe(0);
    expect(repCooldownRemaining(null, now)).toBe(0);
  });

  it("assigns readable reputation badges", () => {
    expect(repBadge(0)).toContain("Nouveau");
    expect(repBadge(5)).toContain("Apprécié");
    expect(repBadge(20)).toContain("Confirmé");
    expect(repBadge(50)).toContain("Vétéran");
    expect(repBadge(100)).toContain("Légende");
  });
});
