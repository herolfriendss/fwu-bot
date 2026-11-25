import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runtimeReportSchema, runtimeStatusRowId, type RuntimeReport, type RuntimeStatus } from "./bot-status";

// Call only after owner authentication or BOT_SYNC_SECRET verification.
export async function readRuntimeStatus(): Promise<RuntimeStatus | null> {
  const { data, error } = await supabaseAdmin
    .from("bot_runtime_status")
    .select("connected,last_seen,last_sync,started_at,events,guilds")
    .eq("id", "primary")
    .maybeSingle();

  if (error) throw new Error("Impossible de lire le statut du bot.");
  if (!data) return null;

  const report = runtimeReportSchema.parse({
    connected: data.connected,
    lastSync: data.last_sync ? new Date(data.last_sync).toISOString() : null,
    startedAt: new Date(data.started_at).toISOString(),
    events: data.events,
    guilds: data.guilds ?? [],
  });

  return { ...report, lastSeen: new Date(data.last_seen).toISOString() };
}

export async function writeRuntimeStatus(report: RuntimeReport) {
  const { error } = await supabaseAdmin.from("bot_runtime_status").upsert({
    id: runtimeStatusRowId(report.profile),
    connected: report.connected,
    last_seen: new Date().toISOString(),
    last_sync: report.lastSync,
    started_at: report.startedAt,
    events: report.events,
    guilds: report.guilds,
  });

  if (error) throw new Error("Impossible d’enregistrer le statut du bot.");
}

const DEDICATED_BOTS = ["guard", "fdpdlavoc", "suckme", "fisc", "investplus"] as const;

/** Last report of each dedicated FWU bot (null when it never reported). */
export async function readDedicatedBotStatuses(): Promise<Record<(typeof DEDICATED_BOTS)[number], { connected: boolean; lastSeen: string; startedAt: string } | null>> {
  const { data, error } = await supabaseAdmin
    .from("bot_runtime_status")
    .select("id,connected,last_seen,started_at")
    .in("id", [...DEDICATED_BOTS]);
  if (error) throw new Error("Impossible de lire le statut des bots.");
  const out = Object.fromEntries(DEDICATED_BOTS.map((id) => [id, null])) as Record<(typeof DEDICATED_BOTS)[number], { connected: boolean; lastSeen: string; startedAt: string } | null>;
  for (const row of data ?? []) {
    if ((DEDICATED_BOTS as readonly string[]).includes(row.id)) {
      out[row.id as (typeof DEDICATED_BOTS)[number]] = { connected: row.connected, lastSeen: new Date(row.last_seen).toISOString(), startedAt: new Date(row.started_at).toISOString() };
    }
  }
  return out;
}
