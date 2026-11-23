import { createFileRoute } from "@tanstack/react-router";
import { parseIncidentInput } from "@/lib/incident-shared";

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/incident")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Owner-only: verified Discord OAuth session; shared dashboard passwords are not accepted.
        const { isOwner } = await import("@/lib/discord.server");
        if (!(await isOwner())) return json(401, "Session expirée : reconnectez-vous.");

        let input;
        try {
          input = parseIncidentInput(await request.json());
        } catch (e) {
          return json(400, e instanceof Error ? e.message : "Requête invalide");
        }

        const { streamIncidentAnalysis } = await import("@/lib/incident.server");
        return streamIncidentAnalysis(request, input.guildId, input.description);
      },
    },
  },
});
