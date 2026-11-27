import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  COMMAND_TTL_MS,
  ONLINE_WINDOW_MS,
  restartCooldownLeftMs,
  type BotCommand,
  type DeliveredCommand,
} from "./bot-control";
import type { BotProfileId } from "./bot-profiles";

type Row = {
  id: string;
  profile: string;
  action: string;
  status: string;
  requested_at: string;
  requested_by: string | null;
  delivered_at: string | null;
};

const toCommand = (row: Row): BotCommand => ({
  id: row.id,
  profile: row.profile as BotProfileId,
  action: "restart",
  status: row.status as BotCommand["status"],
  requestedAt: new Date(row.requested_at).toISOString(),
  requestedBy: row.requested_by,
  deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
});

export type RestartResult =
  | { ok: true; command: BotCommand }
  | { ok: false; reason: "cooldown"; retryInSeconds: number }
  | { ok: false; reason: "already-pending" }
  | { ok: false; reason: "unreachable" };

// À n'appeler qu'après isOwner() : dépose un ordre de redémarrage pour un bot.
export async function requestRestart(profile: BotProfileId, actorId: string): Promise<RestartResult> {
  // Un bot qui ne transmet plus son statut ne lira jamais l'ordre : on le dit tout de suite plutôt que de l'empiler.
  const { data: seen } = await supabaseAdmin
    .from("bot_runtime_status")
    .select("last_seen")
    .eq("id", profile === "fwu" ? "primary" : profile)
    .maybeSingle();
  if (!seen || Date.now() - Date.parse(seen.last_seen) > ONLINE_WINDOW_MS) return { ok: false, reason: "unreachable" };

  const { data: last, error: lastError } = await supabaseAdmin
    .from("bot_control_commands")
    .select("requested_at")
    .eq("profile", profile)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error("Impossible de lire les ordres. Vérifie que la migration bot_control_commands est appliquée.");
  const left = restartCooldownLeftMs(last ? new Date(last.requested_at).toISOString() : null);
  if (left > 0) return { ok: false, reason: "cooldown", retryInSeconds: Math.ceil(left / 1000) };

  // Un éventuel ordre resté « pending » et périmé est fermé avant d'en créer un nouveau.
  await expireStale(profile);

  const { data, error } = await supabaseAdmin
    .from("bot_control_commands")
    .insert({ profile, action: "restart", requested_by: actorId })
    .select("id,profile,action,status,requested_at,requested_by,delivered_at")
    .single();
  // 23505 = index unique : un ordre est déjà en attente pour ce bot.
  if (error?.code === "23505") return { ok: false, reason: "already-pending" };
  if (error || !data) throw new Error("Impossible d’enregistrer l’ordre de redémarrage.");
  return { ok: true, command: toCommand(data as Row) };
}

async function expireStale(profile?: BotProfileId) {
  const limit = new Date(Date.now() - COMMAND_TTL_MS).toISOString();
  let query = supabaseAdmin.from("bot_control_commands").update({ status: "expired" }).eq("status", "pending").lt("requested_at", limit);
  if (profile) query = query.eq("profile", profile);
  await query;
}

/**
 * À n'appeler qu'après la vérification de BOT_SYNC_SECRET, avec le profil du rapport reçu.
 * Livre au maximum un ordre, une seule fois : la mise à jour « pending → delivered » est atomique,
 * deux rapports simultanés ne peuvent donc pas déclencher deux redémarrages.
 */
export async function takePendingCommand(profile: BotProfileId): Promise<DeliveredCommand | null> {
  await expireStale(profile);
  const { data: pending } = await supabaseAdmin
    .from("bot_control_commands")
    .select("id,requested_at")
    .eq("profile", profile)
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pending) return null;
  const { data, error } = await supabaseAdmin
    .from("bot_control_commands")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id,requested_at")
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, action: "restart", issuedAt: new Date(data.requested_at).toISOString() };
}

// Derniers ordres de chaque bot, pour la console (À n'appeler qu'après isOwner()).
export async function readRecentCommands(limit = 40): Promise<BotCommand[]> {
  const { data, error } = await supabaseAdmin
    .from("bot_control_commands")
    .select("id,profile,action,status,requested_at,requested_by,delivered_at")
    .order("requested_at", { ascending: false })
    .limit(limit);
  // La table peut ne pas exister tant que la migration n'est pas appliquée : la console reste utilisable.
  if (error) return [];
  return (data as Row[]).map(toCommand);
}
