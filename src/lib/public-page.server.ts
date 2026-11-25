import type { PublicPage } from "./public-page";

// Small in-memory cache: a public page must not turn visitors into Discord/Supabase traffic
// on the 500 MB VPS. One entry per guild, refreshed at most every 5 minutes.
const CACHE_MS = 5 * 60_000;
const MAX_ENTRIES = 50;
const cache = new Map<string, { at: number; page: PublicPage | null }>();

export async function readPublicPage(guildId: string, now = Date.now()): Promise<PublicPage | null> {
  const hit = cache.get(guildId);
  if (hit && now - hit.at < CACHE_MS) return hit.page;
  const page = await buildFresh(guildId, now);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(guildId, { at: now, page });
  return page;
}

async function buildFresh(guildId: string, now: number): Promise<PublicPage | null> {
  const { readBotSettings } = await import("./bot-settings.server");
  const settings = await readBotSettings(guildId);
  // Disabled pages stop here: no Discord call, nothing else is read.
  if (!settings.publicPage.enabled) return null;
  const [{ discord }, { readEconomySnapshots }, { readRuntimeStatus, readDedicatedBotStatuses }, { buildPublicPage }, { readActivitySnapshot }] = await Promise.all([
    import("./discord.server"), import("./economy.server"), import("./bot-status.server"), import("./public-page"), import("./activity.server"),
  ]);
  const [guild, economy, primary, dedicated, activity] = await Promise.all([
    discord<{ name: string; icon: string | null; approximate_member_count?: number; approximate_presence_count?: number; premium_subscription_count?: number; premium_tier?: number }>(`guilds/${guildId}?with_counts=true`),
    readEconomySnapshots().then((all) => all.find((s) => s.guildId === guildId) ?? null).catch(() => null),
    readRuntimeStatus().catch(() => null),
    readDedicatedBotStatuses().catch(() => ({} as Record<string, null>)),
    readActivitySnapshot(guildId).catch(() => null),
  ]);
  return buildPublicPage({
    guildId,
    settings,
    guild: { name: guild.name, icon: guild.icon, members: guild.approximate_member_count ?? null, online: guild.approximate_presence_count ?? null, boosts: guild.premium_subscription_count ?? null, boostTier: guild.premium_tier ?? null },
    economy,
    activity,
    bots: { fwu: primary ? { connected: primary.connected, lastSeen: primary.lastSeen } : null, ...dedicated },
    now,
  });
}

/** Drops the cached page, so an owner who switches the page off sees it disappear at once. */
export function forgetPublicPage(guildId: string) {
  cache.delete(guildId);
}
