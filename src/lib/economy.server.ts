import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economyReportSchema, economySnapshotSchema, type EconomySnapshot } from "./economy";

// Only reachable after requireOwner() or the BOT_SYNC_SECRET check.
export async function readEconomySnapshots(): Promise<EconomySnapshot[]> {
  const { data, error } = await supabaseAdmin
    .from("bot_economy_snapshots")
    .select("guild_id,guild_name,total_balance,wallet_count,ledger_count,daily_claims,active_games,top_wallets,shop_items,captured_at")
    .order("total_balance", { ascending: false })
    .limit(500);

  if (error) throw new Error("Impossible de lire les soldes PND. Vérifie que la migration bot_economy_snapshots est appliquée.");

  return (data ?? []).flatMap((row) => {
    const parsed = economySnapshotSchema.safeParse({
      guildId: row.guild_id,
      guildName: row.guild_name,
      totalBalance: Number(row.total_balance),
      walletCount: Number(row.wallet_count),
      ledgerCount: Number(row.ledger_count),
      dailyClaims: Number(row.daily_claims),
      activeGames: Number(row.active_games),
      topWallets: row.top_wallets ?? [],
      shopItems: row.shop_items ?? [],
      capturedAt: new Date(row.captured_at).toISOString(),
    });
    // Ignore malformed rows instead of breaking the whole dashboard.
    return parsed.success ? [parsed.data] : [];
  });
}

export async function writeEconomySnapshots(input: unknown): Promise<number> {
  const report = economyReportSchema.parse(input);
  if (!report.snapshots.length) return 0;

  const updatedAt = new Date().toISOString();
  const rows = report.snapshots.map((snapshot) => ({
    guild_id: snapshot.guildId,
    guild_name: snapshot.guildName,
    total_balance: snapshot.totalBalance,
    wallet_count: snapshot.walletCount,
    ledger_count: snapshot.ledgerCount,
    daily_claims: snapshot.dailyClaims,
    active_games: snapshot.activeGames,
    top_wallets: snapshot.topWallets as never,
    shop_items: snapshot.shopItems as never,
    captured_at: snapshot.capturedAt,
    updated_at: updatedAt,
  }));

  const { error } = await supabaseAdmin
    .from("bot_economy_snapshots")
    .upsert(rows, { onConflict: "guild_id" });

  if (error) throw new Error("Impossible d’enregistrer les soldes PND. Vérifie que la migration bot_economy_snapshots est appliquée.");
  return rows.length;
}
