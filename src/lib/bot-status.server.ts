import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runtimeReportSchema, type RuntimeReport, type RuntimeStatus } from "./bot-status";

// Call only after owner authentication or BOT_SYNC_SECRET verification.
export async function readRuntimeStatus(): Promise<RuntimeStatus | null> {
  const { data, error } = await supabaseAdmin.from("bot_runtime_status").select("connected,last_seen,last_sync,started_at,events").eq("id", "primary").maybeSingle();
  if (error) throw new Error("Impossible de lire le statut du bot.");
  if (!data) return null;
  const report = runtimeReportSchema.parse({ connected: data.connected, lastSync: data.last_sync ? new Date(data.last_sync).toISOString() : null, startedAt: new Date(data.started_at).toISOString(), events: data.events });
  return { ...report, lastSeen: new Date(data.last_seen).toISOString() };
}

export async function writeRuntimeStatus(report: RuntimeReport) {
  const { error } = await supabaseAdmin.from("bot_runtime_status").upsert({
    id: "primary", connected: report.connected, last_seen: new Date().toISOString(),
    last_sync: report.lastSync, started_at: report.startedAt, events: report.events,
  });
  if (error) throw new Error("Impossible d’enregistrer le statut du bot.");
}