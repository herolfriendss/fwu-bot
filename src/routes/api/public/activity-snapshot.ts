import { createFileRoute } from "@tanstack/react-router";
import { readBoundedText } from "@/lib/http-body";
import { activityReportSchema } from "@/lib/activity";

// Written by the bot process serving the fwu domain, every 15 minutes (BOT_SYNC_SECRET bearer).
export const Route = createFileRoute("/api/public/activity-snapshot")({ server: { handlers: {
  POST: async ({ request }) => {
    const { checkBotSecret } = await import("@/lib/bot-settings.server");
    const headers = { "Cache-Control": "no-store" };
    if (!checkBotSecret(request)) return Response.json({ error: "unauthorized" }, { status: 401, headers });

    // Bounded payload: aggregates and display names only (about 6 KB per guild).
    const text = await readBoundedText(request, 1_000_000);
    if (text === null) return Response.json({ error: "snapshot too large" }, { status: 413, headers });
    let input: unknown;
    try { input = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400, headers }); }

    const result = activityReportSchema.safeParse(input);
    if (!result.success) return Response.json({ error: "invalid snapshot" }, { status: 400, headers });

    const future = Date.now() + 60_000;
    if (result.data.snapshots.some((s) => Date.parse(s.capturedAt) > future)) {
      return Response.json({ error: "invalid timestamp" }, { status: 400, headers });
    }

    const { writeActivitySnapshots } = await import("@/lib/activity.server");
    const written = await writeActivitySnapshots(result.data);
    return Response.json({ ok: true, written }, { headers });
  },
} } });
