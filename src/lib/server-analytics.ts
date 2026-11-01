import { snowflakeDate, type AuditEntry } from "./incident-shared";

export const CHANNEL_GROUPS = [
  { name: "Texte & annonces", types: [0, 5], fill: "var(--chart-1)" },
  { name: "Vocal & scène", types: [2, 13], fill: "var(--chart-2)" },
  { name: "Catégories", types: [4], fill: "var(--chart-3)" },
  { name: "Forums & médias", types: [15, 16], fill: "var(--chart-5)" },
] as const;

export function groupChannels(channels: { type: number }[]) {
  const groups: { name: string; fill: string; count: number }[] = CHANNEL_GROUPS.map((g) => ({ name: g.name, fill: g.fill, count: channels.filter((c) => (g.types as readonly number[]).includes(c.type)).length }));
  const other = channels.length - groups.reduce((n, g) => n + g.count, 0);
  if (other) groups.push({ name: "Autres", fill: "var(--chart-4)", count: other });
  return groups;
}

export function summarizeAudit(entries: AuditEntry[], days: number, now: number) {
  const day = 86_400_000;
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  const start = end.getTime() - (days - 1) * day;
  const buckets = Array.from({ length: days }, (_, i) => ({ date: new Date(start + i * day).toISOString().slice(0, 10), actions: 0 }));
  const filtered = entries.filter((e) => {
    const time = snowflakeDate(e.id).getTime();
    return time >= start && time <= now;
  });
  for (const entry of filtered) {
    const index = Math.floor((snowflakeDate(entry.id).getTime() - start) / day);
    const bucket = buckets[index];
    if (bucket) bucket.actions++;
  }
  return {
    buckets,
    actions: filtered.length,
    bans: filtered.filter((e) => e.action_type === 22).length,
    kicks: filtered.filter((e) => e.action_type === 20).length,
    // MEMBER_UPDATE (24) includes nickname changes; it is not a timeout count.
    deletions: filtered.filter((e) => e.action_type === 72 || e.action_type === 73).length,
    entries: filtered,
  };
}

export function parseAnalyticsInput(d: { guildId: string }) {
  if (!d || typeof d.guildId !== "string" || !/^\d{5,25}$/.test(d.guildId)) throw new Error("Serveur invalide");
  return { guildId: d.guildId };
}