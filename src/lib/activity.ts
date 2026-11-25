// Shared, client-safe shapes for the FWU XP and activity mirror.
// Format agreed with the bot team (project file equipe/format-instantane-activite.md, 2026-11-25).
// The bot's SQLite stays the source of truth; the site keeps one snapshot per guild.
import { z } from "zod";

const snowflake = z.string().regex(/^\d{5,25}$/);
const count = (max: number) => z.number().int().min(0).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // day in Europe/Paris

export const activityMemberSchema = z.object({
  userId: snowflake,
  displayName: z.string().min(1).max(80).nullable(),
  xp: count(1_000_000_000),
  level: count(1_000),
  messages: count(1_000_000_000),
  voiceMinutes: count(100_000_000),
}).strict();

export const activityDaySchema = z.object({
  day,
  messages: count(10_000_000),
  joins: count(1_000_000),
  leaves: count(1_000_000),
}).strict();

export const activityAnimationSchema = z.object({
  countingRecord: count(999_999_999),
  countingCurrent: count(999_999_999),
  starboardPosts: count(10_000_000),
  qotdPosted: count(1_000_000),
}).strict();

export const activitySnapshotSchema = z.object({
  guildId: snowflake,
  guildName: z.string().min(1).max(100).nullable(),
  levelsEnabled: z.boolean(),
  /** Members with at least 1 XP. */
  rankedMembers: count(10_000_000),
  /** XP leaderboard, first to 25th. */
  topXp: z.array(activityMemberSchema).max(25),
  /** Last 30 days; a day without activity is absent. Days must be unique; the site sorts them. */
  daily: z.array(activityDaySchema).max(30)
    .refine((days) => new Set(days.map((d) => d.day)).size === days.length, { message: "duplicate day" })
    .transform((days) => [...days].sort((a, b) => a.day.localeCompare(b.day))),
  /** null until an animation is configured on this guild. */
  animation: activityAnimationSchema.nullable(),
  capturedAt: z.string().datetime(),
}).strict();

export const activityReportSchema = z.object({
  snapshots: z.array(activitySnapshotSchema).max(500),
}).strict();

export type ActivityMember = z.infer<typeof activityMemberSchema>;
export type ActivityDay = z.infer<typeof activityDaySchema>;
export type ActivitySnapshot = z.infer<typeof activitySnapshotSchema>;

/** Beyond this, the site shows "old data" instead of live. */
export const ACTIVITY_STALE_MS = 45 * 60_000;

/** Fills the 30-day window ending on `lastDay` with zero days, oldest first, for the chart. */
export function fillActivityDays(daily: ActivityDay[], lastDay: string, length = 30): ActivityDay[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const end = Date.parse(`${lastDay}T12:00:00Z`);
  return Array.from({ length }, (_, i) => {
    const key = new Date(end - (length - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return byDay.get(key) ?? { day: key, messages: 0, joins: 0, leaves: 0 };
  });
}

/** Totals over the window, for the summary tiles. */
export function activityTotals(daily: ActivityDay[]) {
  return daily.reduce((t, d) => ({ messages: t.messages + d.messages, joins: t.joins + d.joins, leaves: t.leaves + d.leaves }), { messages: 0, joins: 0, leaves: 0 });
}
