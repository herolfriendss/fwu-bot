// Shared, client-safe shapes for the PND economy mirror.
//
// SQLite on the Oracle VPS remains the single source of truth for balances.
// The bot sends a small, bounded snapshot so the dashboard can display totals
// without ever writing to the economy database. Nothing here contains secrets.
import { z } from "zod";

const snowflake = z.string().regex(/^\d{5,25}$/);
const count = (max: number) => z.number().int().min(0).max(max);

export const economyWalletSchema = z.object({
  userId: snowflake,
  displayName: z.string().min(1).max(80).nullable(),
  // A wallet row exposes balance + bank; each side is capped at 1e12.
  balance: z.number().int().min(0).max(2_000_000_000_000),
}).strict();

export const economyShopItemSchema = z.object({
  roleId: snowflake,
  roleName: z.string().min(1).max(100).nullable(),
  price: z.number().int().min(1).max(1_000_000_000),
}).strict();

export const economySnapshotSchema = z.object({
  guildId: snowflake,
  guildName: z.string().min(1).max(100).nullable(),
  totalBalance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  walletCount: count(10_000_000),
  ledgerCount: count(1_000_000_000),
  dailyClaims: count(10_000_000),
  activeGames: count(100_000),
  topWallets: z.array(economyWalletSchema).max(10),
  shopItems: z.array(economyShopItemSchema).max(25),
  capturedAt: z.string().datetime(),
}).strict();

/** One report may contain every guild the bot is currently in. */
export const economyReportSchema = z.object({
  snapshots: z.array(economySnapshotSchema).max(500),
}).strict();

export type EconomyWallet = z.infer<typeof economyWalletSchema>;
export type EconomyShopItem = z.infer<typeof economyShopItemSchema>;
export type EconomySnapshot = z.infer<typeof economySnapshotSchema>;
export type EconomyReport = z.infer<typeof economyReportSchema>;

/** French PND formatting used by both the bot and the dashboard. */
export function formatPnd(value: number): string {
  return `${Math.round(value).toLocaleString("fr-FR")} PND`;
}

/** A snapshot older than this is displayed as stale instead of live. */
export const ECONOMY_STALE_MS = 15 * 60_000;

export function economySnapshotAge(capturedAt: string, now = Date.now()): number | null {
  const time = Date.parse(capturedAt);
  return Number.isFinite(time) ? Math.max(0, now - time) : null;
}
