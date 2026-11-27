import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { activitySnapshotSchema, type ActivitySnapshot } from "./activity";
import { readRecentCommands } from "./bot-control.server";
import { buildConsoleState, type ConsoleState, type RuntimeRow } from "./console-state";

// À n'appeler qu'après isOwner() : assemble l'état de la console depuis ce que les bots transmettent déjà.
export async function readConsoleState(): Promise<ConsoleState> {
  const [runtime, activity, commands] = await Promise.all([
    supabaseAdmin.from("bot_runtime_status").select("id,connected,last_seen,last_sync,started_at,events,guilds"),
    supabaseAdmin.from("bot_activity_snapshots").select("snapshot"),
    readRecentCommands(),
  ]);
  if (runtime.error) throw new Error("Impossible de lire le statut des bots.");
  const snapshots: ActivitySnapshot[] = [];
  // Une table d'activité absente ou un instantané invalide n'empêche pas d'afficher les bots.
  for (const row of activity.data ?? []) {
    const parsed = activitySnapshotSchema.safeParse(row.snapshot);
    if (parsed.success) snapshots.push(parsed.data);
  }
  return buildConsoleState({ rows: (runtime.data ?? []) as RuntimeRow[], activity: snapshots, commands });
}
