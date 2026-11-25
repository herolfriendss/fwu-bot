import { describe, expect, it } from "vitest";
import { activityReportSchema, activitySnapshotSchema, activityTotals, fillActivityDays } from "@/lib/activity";
import { buildPublicPage } from "@/lib/public-page";
import { sanitizeSettings } from "@/lib/bot-settings";

// Example from the agreed format (equipe/format-instantane-activite.md).
const example = {
  guildId: "123456789012345678", guildName: "PND", levelsEnabled: true, rankedMembers: 412,
  topXp: [{ userId: "223456789012345678", displayName: "Alice", xp: 15230, level: 17, messages: 2310, voiceMinutes: 840 }],
  daily: [{ day: "2026-11-24", messages: 1840, joins: 6, leaves: 2 }, { day: "2026-11-22", messages: 10, joins: 0, leaves: 1 }],
  animation: { countingRecord: 312, countingCurrent: 45, starboardPosts: 18, qotdPosted: 9 },
  capturedAt: "2026-11-25T05:00:00.000Z",
};

describe("activity snapshot", () => {
  it("accepts the agreed example and sorts the days", () => {
    const parsed = activityReportSchema.parse({ snapshots: [example] });
    expect(parsed.snapshots[0]!.daily.map((d) => d.day)).toEqual(["2026-11-22", "2026-11-24"]);
  });

  it("refuses duplicate days, unknown fields and usernames", () => {
    expect(activitySnapshotSchema.safeParse({ ...example, daily: [example.daily[0], example.daily[0]] }).success).toBe(false);
    expect(activitySnapshotSchema.safeParse({ ...example, topXp: [{ ...example.topXp[0], username: "alice#0001" }] }).success).toBe(false);
    expect(activitySnapshotSchema.safeParse({ ...example, topXp: Array(26).fill(example.topXp[0]) }).success).toBe(false);
  });

  it("fills the 30-day window for the chart", () => {
    const days = fillActivityDays(activitySnapshotSchema.parse(example).daily, "2026-11-25");
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ day: "2026-11-25", messages: 0, joins: 0, leaves: 0 });
    expect(days.at(-2)?.messages).toBe(1840);
    expect(days[0]!.day).toBe("2026-10-27");
    expect(activityTotals(days)).toEqual({ messages: 1850, joins: 6, leaves: 3 });
  });

  it("shows XP names on the public page only with the leaderboard option", () => {
    const activity = activitySnapshotSchema.parse(example);
    const guild = { name: "PND", icon: null, members: 1, online: 1, boosts: 0, boostTier: 0 };
    const now = Date.parse("2026-11-25T05:01:00Z");
    const hidden = buildPublicPage({ guildId: example.guildId, settings: sanitizeSettings({ publicPage: { enabled: true } }), guild, economy: null, activity, bots: {}, now })!;
    expect(hidden.activity).toEqual({ rankedMembers: 412, messages30: 1850, xpLeaderboard: null });
    expect(JSON.stringify(hidden)).not.toContain("Alice");
    const shown = buildPublicPage({ guildId: example.guildId, settings: sanitizeSettings({ publicPage: { enabled: true, showLeaderboard: true } }), guild, economy: null, activity, bots: {}, now })!;
    expect(shown.activity?.xpLeaderboard).toEqual([{ rank: 1, name: "Alice", level: 17 }]);
    expect(JSON.stringify(shown)).not.toContain("223456789012345678");
  });
});
