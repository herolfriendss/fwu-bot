// Public showcase page of a server. Pure builder: decides what may leave the owner-only area.
// Only aggregates, the bots' state and the public command list are exposed; member names appear
// only when the owner turned the leaderboard on. Never settings, ids of roles/channels, or logs.
import type { BotSettings } from "./bot-settings";
import type { EconomySnapshot } from "./economy";
import { activityTotals, type ActivitySnapshot } from "./activity";
import { BOT_PROFILES, BOT_PROFILE_IDS, slashCommandOwner, SHARED_SLASH_COMMANDS, type BotProfileId } from "./bot-profiles";
import { SLASH_COMMANDS } from "./slash-commands";

export type PublicGuildCounts = { name: string; icon: string | null; members: number | null; online: number | null; boosts: number | null; boostTier: number | null };
export type PublicBotState = { connected: boolean; lastSeen: string } | null;

export type PublicPage = {
  guildId: string;
  name: string;
  iconUrl: string | null;
  members: number | null;
  online: number | null;
  boosts: number | null;
  boostTier: number | null;
  bots: { id: BotProfileId; label: string; summary: string; online: boolean }[];
  economy: { totalBalance: number; walletCount: number; shop: { name: string; price: number }[]; leaderboard: { rank: number; name: string; balance: number }[] | null } | null;
  activity: { rankedMembers: number; messages30: number; xpLeaderboard: { rank: number; name: string; level: number }[] | null } | null;
  commands: { category: string; items: { name: string; description: string; bot: string }[] }[];
  generatedAt: string;
};

const ONLINE_MS = 70_000;

/** Member-facing categories. Staff categories (Modération, SYS+, Administration…) are never listed publicly. */
export const PUBLIC_COMMAND_CATEGORIES = ["Général", "Communauté", "Social", "Social & cartes", "Jeux & événements", "Économie", "Économie PND", "Musique & radio", "Utilitaires"] as const;

/** Commands for members, grouped by category, with the bot that answers them. */
export function publicCommandList() {
  const allowed = new Set<string>(PUBLIC_COMMAND_CATEGORIES);
  const groups = new Map<string, { name: string; description: string; bot: string }[]>();
  for (const command of SLASH_COMMANDS) {
    if (!allowed.has(command.category)) continue;
    if (command.defaultMemberPermissions && command.defaultMemberPermissions !== "0") continue;
    const bot = SHARED_SLASH_COMMANDS.includes(command.name) ? "Tous les bots" : BOT_PROFILES[slashCommandOwner(command.name) ?? "fwu"].label;
    groups.set(command.category, [...(groups.get(command.category) ?? []), { name: command.name, description: command.description, bot }]);
  }
  return PUBLIC_COMMAND_CATEGORIES.filter((c) => groups.has(c)).map((category) => ({
    category,
    items: groups.get(category)!.sort((a, b) => a.name.localeCompare(b.name, "fr")),
  }));
}

export function buildPublicPage(input: {
  guildId: string;
  settings: BotSettings;
  guild: PublicGuildCounts;
  economy: EconomySnapshot | null;
  activity?: ActivitySnapshot | null;
  bots: Partial<Record<BotProfileId, PublicBotState>>;
  now: number;
}): PublicPage | null {
  const { guildId, settings, guild, economy, bots, now } = input;
  const activity = input.activity ?? null;
  if (!settings.publicPage.enabled) return null;
  return {
    guildId,
    name: guild.name,
    iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png?size=128` : null,
    members: guild.members,
    online: guild.online,
    boosts: guild.boosts,
    boostTier: guild.boostTier,
    bots: BOT_PROFILE_IDS.map((id) => {
      const state = bots[id];
      return { id, label: BOT_PROFILES[id].label, summary: BOT_PROFILES[id].summary, online: Boolean(state?.connected && now - Date.parse(state.lastSeen) <= ONLINE_MS) };
    }),
    economy: economy ? {
      totalBalance: economy.totalBalance,
      walletCount: economy.walletCount,
      shop: economy.shopItems.map((item) => ({ name: item.roleName ?? "Rôle", price: item.price })),
      leaderboard: settings.publicPage.showLeaderboard
        ? economy.topWallets.map((w, i) => ({ rank: i + 1, name: w.displayName ?? "Membre", balance: w.balance }))
        : null,
    } : null,
    activity: activity ? {
      rankedMembers: activity.rankedMembers,
      messages30: activityTotals(activity.daily).messages,
      xpLeaderboard: settings.publicPage.showLeaderboard && activity.levelsEnabled
        ? activity.topXp.slice(0, 10).map((m, i) => ({ rank: i + 1, name: m.displayName ?? "Membre", level: m.level }))
        : null,
    } : null,
    commands: publicCommandList(),
    generatedAt: new Date(now).toISOString(),
  };
}
