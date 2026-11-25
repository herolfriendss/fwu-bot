import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { activityReportSchema, activitySnapshotSchema, type ActivitySnapshot } from "./activity";

// Only reachable after requireOwner(), the BOT_SYNC_SECRET check, or the opt-in public page.
export async function readActivitySnapshot(guildId: string): Promise<ActivitySnapshot | null> {
  const { data, error } = await supabaseAdmin.from("bot_activity_snapshots").select("snapshot").eq("guild_id", guildId).maybeSingle();
  if (error) throw new Error("Impossible de lire l’activité. Vérifie que la migration bot_activity_snapshots est appliquée.");
  const parsed = activitySnapshotSchema.safeParse(data?.snapshot);
  return parsed.success ? parsed.data : null;
}

export async function writeActivitySnapshots(input: unknown): Promise<number> {
  const report = activityReportSchema.parse(input);
  if (!report.snapshots.length) return 0;
  const updatedAt = new Date().toISOString();
  const rows = report.snapshots.map((snapshot) => ({ guild_id: snapshot.guildId, snapshot: snapshot as never, captured_at: snapshot.capturedAt, updated_at: updatedAt }));
  const { error } = await supabaseAdmin.from("bot_activity_snapshots").upsert(rows, { onConflict: "guild_id" });
  if (error) throw new Error("Impossible d’enregistrer l’activité. Vérifie que la migration bot_activity_snapshots est appliquée.");
  return rows.length;
}
