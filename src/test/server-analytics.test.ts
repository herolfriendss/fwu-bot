import { describe, expect, it, vi } from "vitest";
import { groupChannels, parseAnalyticsInput, summarizeAudit } from "@/lib/server-analytics";

const mocks = vi.hoisted(() => ({ discord: vi.fn() }));
vi.mock("@/lib/discord.server", () => ({ discord: mocks.discord }));
import { readServerAnalytics } from "@/lib/server-analytics.server";

const idAt = (date: string) => ((BigInt(new Date(date).getTime() - 1420070400000)) << 22n).toString();
describe("server analytics", () => {
  it("rejects paths in a server identifier", () => {
    expect(() => parseAnalyticsInput({ guildId: "../users/@me" })).toThrow();
  });
  it("counts all channel types without counting categories as text channels", () => {
    const groups = groupChannels([{ type: 0 }, { type: 5 }, { type: 4 }, { type: 2 }, { type: 13 }, { type: 15 }, { type: 99 }]);
    expect(groups.map((g) => g.count)).toEqual([2, 2, 1, 1, 1]);
  });
  it("uses seven UTC days, excludes old/future entries and does not treat member updates as bans", () => {
    const entries = [
      { id: idAt("2026-10-23T00:00:00Z"), action_type: 22, user_id: null, target_id: null },
      { id: idAt("2026-10-29T12:00:00Z"), action_type: 24, user_id: null, target_id: null },
      { id: idAt("2026-10-22T23:59:59Z"), action_type: 20, user_id: null, target_id: null },
      { id: idAt("2026-10-30T00:00:00Z"), action_type: 22, user_id: null, target_id: null },
    ];
    const result = summarizeAudit(entries, 7, new Date("2026-10-29T13:25:00Z").getTime());
    expect(result.buckets).toHaveLength(7);
    expect(result.buckets[0]).toEqual({ date: "2026-10-23", actions: 1 });
    expect(result.actions).toBe(2);
    expect(result.bans).toBe(1);
    expect(result.kicks).toBe(0);
  });
  it("keeps unavailable audit counts null and preserves real guild counts", async () => {
    mocks.discord.mockImplementation(async (path: string) => {
      if (path.includes("with_counts")) return { name: "Serveur", approximate_member_count: 1240, approximate_presence_count: 87 };
      if (path.endsWith("/channels")) return [{ type: 0 }];
      if (path.endsWith("/roles")) return [{ id: "123456" }, { id: "654321" }];
      throw new Error("Discord [403]");
    });
    const result = await readServerAnalytics("123456");
    expect(result.members).toBe(1240);
    expect(result.online).toBe(87);
    expect(result.roles).toBe(1);
    expect(result.audit).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });
});