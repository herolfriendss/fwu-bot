import { createFileRoute } from "@tanstack/react-router";
import { readBoundedText } from "@/lib/http-body";
import { authoritySyncSchema } from "@/lib/authority-console";

// Written by the bot carrying /authority (SUCK ME) every minute, BOT_SYNC_SECRET bearer.
// Answers with the console decisions waiting for this bot's guilds.
export const Route = createFileRoute("/api/public/authority-sync")({ server: { handlers: {
  POST: async ({ request }) => {
    const { checkBotSecret } = await import("@/lib/bot-settings.server");
    const headers = { "Cache-Control": "no-store" };
    if (!checkBotSecret(request)) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const text = await readBoundedText(request, 500_000);
    if (text === null) return Response.json({ error: "too large" }, { status: 413, headers });
    let input: unknown;
    try { input = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400, headers }); }
    const parsed = authoritySyncSchema.safeParse(input);
    if (!parsed.success) return Response.json({ error: "invalid sync" }, { status: 400, headers });
    try {
      const { syncAuthority } = await import("@/lib/authority-console.server");
      return Response.json({ ok: true, decisions: await syncAuthority(parsed.data) }, { headers });
    } catch {
      return Response.json({ error: "storage unavailable" }, { status: 503, headers });
    }
  },
} } });
