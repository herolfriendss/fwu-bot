import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authoritySnapshotSchema, authoritySyncSchema, type AuthorityDecisionInput, type PendingDecision } from "./authority-console";

const MISSING = "Vérifie que la migration bot_authority_console est appliquée.";

// Reached only after checkBotSecret(): stores the snapshots, records the bot's results,
// and returns the decisions still waiting for the guilds this bot serves.
export async function syncAuthority(input: unknown): Promise<PendingDecision[]> {
  const report = authoritySyncSchema.parse(input);
  if (report.snapshots.length) {
    const updatedAt = new Date().toISOString();
    const rows = report.snapshots.map((s) => ({ guild_id: s.guildId, snapshot: s as never, captured_at: s.capturedAt, updated_at: updatedAt }));
    const { error } = await supabaseAdmin.from("bot_authority_snapshots").upsert(rows, { onConflict: "guild_id" });
    if (error) throw new Error(`Instantané AUTHORITY non enregistré. ${MISSING}`);
  }
  for (const r of report.results) {
    await supabaseAdmin.from("bot_authority_decisions")
      .update({ status: r.ok ? "applied" : "refused", result: r.result, applied_at: new Date().toISOString() })
      .eq("id", r.id).eq("status", "pending");
  }
  const guilds = report.snapshots.map((s) => s.guildId);
  if (!guilds.length) return [];
  const { data, error } = await supabaseAdmin.from("bot_authority_decisions")
    .select("id, guild_id, number, action, nonce, duration_ms").eq("status", "pending").in("guild_id", guilds).order("requested_at").limit(20);
  if (error) throw new Error(`Décisions AUTHORITY illisibles. ${MISSING}`);
  return (data ?? []).map((d) => ({ id: d.id, guildId: d.guild_id, number: d.number, action: d.action, nonce: d.nonce, durationMs: d.duration_ms }));
}

// Reached only after isOwner().
export async function readAuthorityConsole() {
  const [{ data: snaps, error: e1 }, { data: decisions, error: e2 }] = await Promise.all([
    supabaseAdmin.from("bot_authority_snapshots").select("snapshot, captured_at"),
    supabaseAdmin.from("bot_authority_decisions").select("id, guild_id, number, action, status, result, requested_at, applied_at").order("requested_at", { ascending: false }).limit(30),
  ]);
  if (e1 || e2) throw new Error(`Lecture AUTHORITY impossible. ${MISSING}`);
  const snapshots = (snaps ?? []).map((row) => authoritySnapshotSchema.safeParse(row.snapshot)).filter((r) => r.success).map((r) => r.data);
  return { snapshots, decisions: decisions ?? [] };
}

// Reached only after isOwner(): queues a decision; the bot applies it with the registry's own checks.
export async function queueAuthorityDecision(input: AuthorityDecisionInput, actorId: string | null) {
  const { error } = await supabaseAdmin.from("bot_authority_decisions").insert({
    guild_id: input.guildId, number: input.number, action: input.action,
    nonce: input.nonce ?? null, duration_ms: input.durationHours ? input.durationHours * 3_600_000 : null, requested_by: actorId,
  });
  if (error) {
    if (error.code === "23505") return { ok: false as const, error: "Une décision attend déjà d'être appliquée pour cette demande." };
    return { ok: false as const, error: `Décision non enregistrée. ${MISSING}` };
  }
  return { ok: true as const };
}
