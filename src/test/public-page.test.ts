import { describe, expect, it } from "vitest";
import { sanitizeSettings } from "@/lib/bot-settings";
import { buildPublicPage, publicCommandList } from "@/lib/public-page";
import type { EconomySnapshot } from "@/lib/economy";

const now = Date.parse("2026-11-25T05:00:00Z");
const guild = { name: "PND", icon: null, members: 120, online: 40, boosts: 3, boostTier: 1 };
const economy: EconomySnapshot = {
  guildId: "123456", guildName: "PND", totalBalance: 5000, walletCount: 2, ledgerCount: 10, dailyClaims: 1, activeGames: 0,
  topWallets: [{ userId: "111111", displayName: "Alice", balance: 4000 }, { userId: "222222", displayName: null, balance: 1000 }],
  shopItems: [{ roleId: "333333", roleName: "VIP", price: 900 }],
  capturedAt: "2026-11-25T04:59:00.000Z",
};

describe("public server page", () => {
  it("is not built unless the owner switched it on", () => {
    expect(buildPublicPage({ guildId: "123456", settings: sanitizeSettings({}), guild, economy, bots: {}, now })).toBeNull();
  });

  it("hides member names unless the leaderboard is switched on", () => {
    const page = buildPublicPage({ guildId: "123456", settings: sanitizeSettings({ publicPage: { enabled: true } }), guild, economy, bots: {}, now })!;
    expect(page.economy?.leaderboard).toBeNull();
    expect(JSON.stringify(page)).not.toContain("Alice");
    expect(JSON.stringify(page)).not.toContain("111111");
    expect(JSON.stringify(page)).not.toContain("333333");
  });

  it("shows the leaderboard and the bots' state when allowed", () => {
    const settings = sanitizeSettings({ publicPage: { enabled: true, showLeaderboard: true } });
    const page = buildPublicPage({ guildId: "123456", settings, guild, economy, bots: { guard: { connected: true, lastSeen: "2026-11-25T04:59:30.000Z" }, fisc: { connected: true, lastSeen: "2026-11-25T04:00:00.000Z" } }, now })!;
    expect(page.economy?.leaderboard).toEqual([{ rank: 1, name: "Alice", balance: 4000 }, { rank: 2, name: "Membre", balance: 1000 }]);
    expect(page.bots.find((b) => b.id === "guard")?.online).toBe(true);
    expect(page.bots.find((b) => b.id === "fisc")?.online).toBe(false);
    expect(page.bots).toHaveLength(5);
  });

  it("lists only commands any member can run", () => {
    const names = publicCommandList().flatMap((g) => g.items.map((c) => c.name));
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("ban");
    expect(names).not.toContain("sysp");
  });
});
