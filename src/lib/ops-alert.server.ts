import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WEBHOOK = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

/** Coarse device label from a User-Agent, never the raw header. */
export function describeDevice(userAgent: string | null): string {
  const ua = String(userAgent ?? "");
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "appareil inconnu";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navigateur inconnu";
  return `${browser} sur ${os}`;
}

/**
 * Posts a short message on the staff alert webhook configured in Supabase
 * (ops_alert_settings, the same one as the outage alerts). Silent when not set up.
 */
export async function postOpsAlert(content: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.from("ops_alert_settings" as never).select("webhook_url, enabled").eq("id", 1).maybeSingle();
    const row = data as { webhook_url: string | null; enabled: boolean } | null;
    if (!row?.enabled || !row.webhook_url || !WEBHOOK.test(row.webhook_url)) return false;
    const response = await fetch(row.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
