import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeSettings, type BotSettings } from "./bot-settings";
import { timingSafeEqual } from "node:crypto";

// Call only after requireOwner() or the BOT_SYNC_SECRET check.
export async function readBotSettings(guildId: string): Promise<BotSettings> {
  const { data, error } = await supabaseAdmin.from("bot_settings").select("settings").eq("guild_id", guildId).maybeSingle();
  if (error) throw new Error("Impossible de lire les réglages du bot.");
  return sanitizeSettings(data?.settings);
}

export async function readAllBotSettings(): Promise<Record<string, BotSettings>> {
  const { data, error } = await supabaseAdmin.from("bot_settings").select("guild_id, settings");
  if (error) throw new Error("Impossible de lire les réglages du bot.");
  return Object.fromEntries((data ?? []).map((r) => [r.guild_id, sanitizeSettings(r.settings)]));
}

export async function writeBotSettings(guildId: string, settings: BotSettings, updateCommands = false) {
  // General settings saves must not overwrite commands edited in another tab.
  const latest = await readBotSettings(guildId);
  const next = { ...settings, voiceAccess: latest.voiceAccess, prefixCommands: updateCommands ? settings.prefixCommands : latest.prefixCommands };
  const { error } = await supabaseAdmin
    .from("bot_settings")
    .upsert({ guild_id: guildId, settings: next as never, updated_at: new Date().toISOString() });
  if (error) throw new Error("Impossible d’enregistrer les réglages du bot.");
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
