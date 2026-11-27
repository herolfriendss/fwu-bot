import { createFileRoute } from "@tanstack/react-router";
import { readBoundedText } from "@/lib/http-body";
import { runtimeReportSchema } from "@/lib/bot-status";

export const Route = createFileRoute("/api/public/bot-status")({ server: { handlers: {
  POST: async ({ request }) => {
    const { checkBotSecret } = await import("@/lib/bot-settings.server");
    const headers = { "Cache-Control": "no-store" };
    if (!checkBotSecret(request)) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    // Only known event codes, never arbitrary logs, tokens or message contents.
    const text = await readBoundedText(request, 12_000);
    if (text === null) return Response.json({ error: "report too large" }, { status: 413, headers });
    let input: unknown;
    try { input = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400, headers }); }
    const result = runtimeReportSchema.safeParse(input);
    if (!result.success) return Response.json({ error: "invalid report" }, { status: 400, headers });
    const times = [result.data.startedAt, result.data.lastSync, ...result.data.events.map((e) => e.at)].filter((t): t is string => t !== null);
    if (times.some((t) => Date.parse(t) > Date.now() + 60_000)) return Response.json({ error: "invalid timestamp" }, { status: 400, headers });
    const { writeRuntimeStatus } = await import("@/lib/bot-status.server");
    await writeRuntimeStatus(result.data);
    // Console du site : un éventuel ordre de redémarrage pour CE bot part dans la réponse (livré une seule fois).
    // Une panne de cette étape ne doit jamais empêcher l'enregistrement du statut.
    let command = null;
    try {
      const { takePendingCommand } = await import("@/lib/bot-control.server");
      command = await takePendingCommand(result.data.profile ?? "fwu");
    } catch { /* table absente avant la migration, ou base injoignable */ }
    return Response.json({ ok: true, command }, { headers });
  },
} } });