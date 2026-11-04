import { createFileRoute } from "@tanstack/react-router";
import { economyReportSchema } from "@/lib/economy";

export const Route = createFileRoute("/api/public/economy-snapshot")({ server: { handlers: {
  POST: async ({ request }) => {
    const { checkBotSecret } = await import("@/lib/bot-settings.server");
    const headers = { "Cache-Control": "no-store" };
    if (!checkBotSecret(request)) return Response.json({ error: "unauthorized" }, { status: 401, headers });

    // Bounded payload: aggregates, display names and role names only.
    const text = await request.text();
    if (text.length > 1_000_000) return Response.json({ error: "snapshot too large" }, { status: 413, headers });
    let input: unknown;
    try { input = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400, headers }); }

    const result = economyReportSchema.safeParse(input);
    if (!result.success) return Response.json({ error: "invalid snapshot" }, { status: 400, headers });

    const future = Date.now() + 60_000;
    if (result.data.snapshots.some((s) => Date.parse(s.capturedAt) > future)) {
      return Response.json({ error: "invalid timestamp" }, { status: 400, headers });
    }

    const { writeEconomySnapshots } = await import("@/lib/economy.server");
    const written = await writeEconomySnapshots(result.data);
    return Response.json({ ok: true, written }, { headers });
  },
} } });
