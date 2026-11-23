import { describe, expect, it } from "vitest";
import {
  ECONOMY_STALE_MS,
  economyReportSchema,
  economySnapshotAge,
  economySnapshotSchema,
  formatPnd,
} from "@/lib/economy";

const snapshot = {
  guildId: "123456789012345678",
  guildName: "Serveur test",
  totalBalance: 42_500,
  walletCount: 12,
  ledgerCount: 90,
  dailyClaims: 8,
  activeGames: 1,
  topWallets: [{ userId: "223456789012345678", displayName: "Ryan", balance: 20_000 }],
  shopItems: [{ roleId: "323456789012345678", roleName: "VIP", price: 5_000 }],
  capturedAt: "2026-11-04T10:00:00.000Z",
};

describe("economy snapshot", () => {
  it("accepts a bounded snapshot and formats PND in French", () => {
    expect(economySnapshotSchema.parse(snapshot).guildId).toBe(snapshot.guildId);
    expect(formatPnd(0)).toBe("0 PND");
    expect(formatPnd(42_500)).toContain("PND");
  });

  it("rejects extra fields, invalid ids and negative totals", () => {
    expect(economySnapshotSchema.safeParse({ ...snapshot, secret: "nope" }).success).toBe(false);
    expect(economySnapshotSchema.safeParse({ ...snapshot, guildId: "abc" }).success).toBe(false);
    expect(economySnapshotSchema.safeParse({ ...snapshot, totalBalance: -1 }).success).toBe(false);
    expect(economySnapshotSchema.safeParse({
      ...snapshot,
      topWallets: [{ ...snapshot.topWallets[0], balance: 2_000_000_000_000 }],
    }).success).toBe(true);
  });

  it("caps the leaderboard, shop and guild report sizes", () => {
    const wallet = snapshot.topWallets[0];
    expect(economySnapshotSchema.safeParse({ ...snapshot, topWallets: Array(10).fill(wallet) }).success).toBe(true);
    expect(economySnapshotSchema.safeParse({ ...snapshot, topWallets: Array(11).fill(wallet) }).success).toBe(false);
    expect(economySnapshotSchema.safeParse({ ...snapshot, shopItems: Array(26).fill(snapshot.shopItems[0]) }).success).toBe(false);
    expect(economyReportSchema.safeParse({ snapshots: Array(500).fill(snapshot) }).success).toBe(true);
    expect(economyReportSchema.safeParse({ snapshots: Array(501).fill(snapshot) }).success).toBe(false);
  });

  it("reports snapshot age and marks stale data", () => {
    const captured = Date.parse(snapshot.capturedAt);
    expect(economySnapshotAge(snapshot.capturedAt, captured + 60_000)).toBe(60_000);
    expect(economySnapshotAge("not-a-date")).toBeNull();
    expect(captured + ECONOMY_STALE_MS).toBeGreaterThan(captured);
  });
});
