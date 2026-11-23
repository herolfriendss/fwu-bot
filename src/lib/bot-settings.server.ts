import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mergeSettingsForWrite, sanitizeSettings, type BotSettings } from "./bot-settings";
import { timingSafeEqual } from "node:crypto";

// Call only after requireOwner() or the BOT_SYNC_SECRET check.
export async function readBotSettings(guildId: string): Promise<BotSettings> {
  const { data, error } = await supabaseAdmin.from("bot_settings").select("settings").eq("guild_id", guildId).maybeSingle();
  if (error) {
    console.error("[bot-settings] Supabase read failed:", { code: error.code, message: error.message });
    throw new Error(`bot_settings_read_failed:${error.code ?? "unknown"}`);
  }
  return sanitizeSettings(data?.settings);
}

export async function readAllBotSettings(): Promise<Record<string, BotSettings>> {
  const { data, error } = await supabaseAdmin.from("bot_settings").select("guild_id, settings");
  if (error) {
    console.error("[bot-settings] Supabase bulk read failed:", { code: error.code, message: error.message });
    throw new Error(`bot_settings_read_failed:${error.code ?? "unknown"}`);
  }
  return Object.fromEntries((data ?? []).map((r) => [r.guild_id, sanitizeSettings(r.settings)]));
}

export async function writeBotSettings(guildId: string, settings: BotSettings, updateCommands = false) {
  // General settings saves must not overwrite commands edited in another tab.
  const latest = await readBotSettings(guildId);
  const next = mergeSettingsForWrite(settings, latest, updateCommands);
  const { error } = await supabaseAdmin
    .from("bot_settings")
    .upsert({ guild_id: guildId, settings: next as never, updated_at: new Date().toISOString() });
  if (error) {
    console.error("[bot-settings] Supabase upsert failed:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new Error(`bot_settings_write_failed:${error.code ?? "unknown"}`);
  }
  if (latest.ai.memoryEnabled === true && next.ai.memoryEnabled !== true) {
    const { error: purgeError } = await supabaseAdmin.from("bot_ai_memory").delete().eq("guild_id", guildId);
    if (purgeError) throw new Error("Les réglages sont enregistrés, mais la purge de la mémoire IA a échoué. Réessaie ou vérifie la table bot_ai_memory.");
  }
  return next;
}

export function checkBotSecret(request: Request): boolean {
  const expected = process.env["BOT_SYNC_SECRET"];
  const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected) return false;
  const received = Buffer.from(got);
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}
