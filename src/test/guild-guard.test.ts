import { describe, expect, it } from "vitest";
import { accountAgeDays, evaluateJoin, parseGuildAllowlist, raidTriggered } from "../../bot/guild-guard-policy.js";
import { sanitizeSettings } from "@/lib/bot-settings";

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000);
const baseGuard = {
  enabled: true,
  minAccountAgeDays: 7,
  youngAccountAction: "kick" as const,
  quarantineRoleId: "333333333333333333",
  logChannelId: "444444444444444444",
  raidJoinThreshold: 10,
  raidWindowSeconds: 60,
  lockdown: false,
};

describe("GuildGuard policy", () => {
  it("parses a deduplicated guild allowlist and ignores invalid ids", () => {
    expect(parseGuildAllowlist("111111111111111111, 222222222222222222 111111111111111111 abc")).toEqual([
      "111111111111111111",
      "222222222222222222",
    ]);
    expect(parseGuildAllowlist("")).toEqual([]);
  });

  it("computes account age and never returns a negative age", () => {
    expect(accountAgeDays(daysAgo(7), NOW)).toBeCloseTo(7, 5);
    expect(accountAgeDays(new Date(NOW + 86_400_000), NOW)).toBe(0);
    expect(accountAgeDays("not-a-date", NOW)).toBe(0);
  });

  it("detects a join burst inside the window only above the threshold", () => {
    const timestamps = [NOW - 59_000, NOW - 30_000, NOW - 1_000];
    expect(raidTriggered(timestamps, NOW, 60_000, 2)).toBe(true);
    expect(raidTriggered(timestamps, NOW, 60_000, 3)).toBe(false);
    expect(raidTriggered([NOW - 120_000], NOW, 60_000, 0)).toBe(false);
  });

  it("allows members when GuildGuard is disabled regardless of account age", () => {
    expect(evaluateJoin({ createdAt: NOW, now: NOW, guard: { ...baseGuard, enabled: false } })).toEqual({ action: "allow", reason: null });
  });

  it("applies the configured action to young accounts", () => {
    expect(evaluateJoin({ createdAt: daysAgo(1), now: NOW, guard: baseGuard })).toEqual({ action: "kick", reason: "young_account" });
    expect(evaluateJoin({ createdAt: daysAgo(30), now: NOW, guard: baseGuard })).toEqual({ action: "allow", reason: null });
  });

  it("falls back to logging when quarantine has no role", () => {
    expect(evaluateJoin({ createdAt: daysAgo(1), now: NOW, guard: { ...baseGuard, youngAccountAction: "quarantine", quarantineRoleId: null } }))
      .toEqual({ action: "log", reason: "young_account" });
  });

  it("lockdown overrides account age and raid only sanctions young accounts", () => {
    const lockdown = evaluateJoin({ createdAt: daysAgo(30), now: NOW, guard: { ...baseGuard, lockdown: true } });
    expect(lockdown).toEqual({ action: "kick", reason: "lockdown" });
    // Raid sanctions only target accounts that also fail the age threshold, so a
    // raid burst cannot kick established members (see commit 99422b3).
    const establishedDuringRaid = evaluateJoin({ createdAt: daysAgo(30), now: NOW, guard: baseGuard, raidMode: true });
    expect(establishedDuringRaid).toEqual({ action: "allow", reason: null });
    const youngDuringRaid = evaluateJoin({ createdAt: daysAgo(1), now: NOW, guard: baseGuard, raidMode: true });
    expect(youngDuringRaid).toEqual({ action: "kick", reason: "raid" });
  });
});

describe("GuildGuard settings isolation", () => {
  it("provides safe defaults for legacy guild settings", () => {
    const s = sanitizeSettings({});
    expect(s.guildGuard).toMatchObject({ enabled: false, minAccountAgeDays: 7, youngAccountAction: "log", lockdown: false });
    expect(s.tempVoice.enabled).toBe(false);
    expect(s.tickets.maxOpenPerUser).toBe(1);
    expect(s.automation.autoRoleIds).toEqual([]);
  });

  it("clamps values and keeps each guild's configuration independent", () => {
    const locked = sanitizeSettings({ guildGuard: { enabled: true, minAccountAgeDays: 9999, raidJoinThreshold: -3, youngAccountAction: "nuke" } });
    expect(locked.guildGuard.minAccountAgeDays).toBe(365);
    expect(locked.guildGuard.raidJoinThreshold).toBe(0);
    expect(locked.guildGuard.youngAccountAction).toBe("log");

    const other = sanitizeSettings({});
    expect(other.guildGuard.enabled).toBe(false);
    expect(other.tickets).not.toBe(locked.tickets);
  });

  it("keeps only valid, deduplicated role ids and caps automation roles", () => {
    const s = sanitizeSettings({ automation: { autoRoleIds: ["111111111111111111", "111111111111111111", "abc", "222222222222222222"] } });
    expect(s.automation.autoRoleIds).toEqual(["111111111111111111", "222222222222222222"]);
    const many = sanitizeSettings({ automation: { autoRoleIds: Array.from({ length: 20 }, (_, i) => String(100000000000000000n + BigInt(i))) } });
    expect(many.automation.autoRoleIds).toHaveLength(10);
  });
});
