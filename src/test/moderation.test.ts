import { describe, expect, it } from "vitest";
import {
  activeWarnings, canModerate, formatDuration, parseDuration, sanitizeReason, verificationEligible, warningExpiry,
} from "../../bot/moderation-policy.js";

const base = {
  actorId: "111111111111111111",
  targetId: "222222222222222222",
  guildOwnerId: "999999999999999999",
  actorPermissions: "8192",
  targetPermissions: "0",
  actorPosition: 10,
  targetPosition: 5,
  botPosition: 20,
  requiredBit: "8192",
};

describe("moderation policy", () => {
  it("accepts valid human durations and rejects invalid or over-limit values", () => {
    expect(parseDuration("10m")).toBe(10);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1d")).toBe(1440);
    expect(parseDuration("28d")).toBe(40_320);
    expect(parseDuration("30s")).toBeNull();
    expect(parseDuration("nope")).toBeNull();
    expect(parseDuration("99999d")).toBeNull();
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(1440)).toBe("1 j");
  });

  it("requires the permission bit and a higher role than the target", () => {
    expect(canModerate(base)).toEqual({ allowed: true, reason: null });
    expect(canModerate({ ...base, actorPermissions: "0" }).allowed).toBe(false);
    expect(canModerate({ ...base, actorPosition: 5 }).allowed).toBe(false);
    expect(canModerate({ ...base, targetPosition: 25 }).allowed).toBe(false);
  });

  it("protects the owner, administrators and the actor themself", () => {
    expect(canModerate({ ...base, targetId: base.guildOwnerId }).allowed).toBe(false);
    expect(canModerate({ ...base, targetPermissions: "8" }).allowed).toBe(false);
    expect(canModerate({ ...base, targetId: base.actorId }).allowed).toBe(false);
  });

  it("lets the guild owner bypass role-position checks but not the bot hierarchy", () => {
    expect(canModerate({ ...base, actorId: base.guildOwnerId, actorPermissions: "0", actorPosition: 1 }).allowed).toBe(true);
    expect(canModerate({ ...base, actorId: base.guildOwnerId, targetPosition: 30, botPosition: 20 }).allowed).toBe(false);
  });

  it("keeps only non-expired warnings", () => {
    const now = Date.now();
    const rows = [
      { id: 1, expires_at: null },
      { id: 2, expires_at: now + 1_000 },
      { id: 3, expires_at: now - 1_000 },
    ];
    expect(activeWarnings(rows, now).map((w) => w.id)).toEqual([1, 2]);
    expect(warningExpiry(now, 0)).toBeNull();
    expect(warningExpiry(now, 2)).toBe(now + 2 * 86_400_000);
  });

  it("checks verification account age and sanitizes reasons", () => {
    const now = Date.UTC(2026, 10, 4);
    expect(verificationEligible(new Date(now - 10 * 86_400_000), now, 7).eligible).toBe(true);
    expect(verificationEligible(new Date(now - 2 * 86_400_000), now, 7).eligible).toBe(false);
    expect(verificationEligible("bad-date", now, 0).eligible).toBe(false);
    expect(sanitizeReason("  insulte\nrépétée  ")).toBe("insulte répétée");
    expect(sanitizeReason("")).toBe("Aucune raison fournie");
  });
});
