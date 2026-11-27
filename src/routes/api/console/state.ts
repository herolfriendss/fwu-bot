import { createFileRoute } from "@tanstack/react-router";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Lecture seule pour la console (/console/). Réservé à l'OWNER connecté (cookie de session).
export const Route = createFileRoute("/api/console/state")({
  server: {
    handlers: {
      GET: async () => {
        const { isOwner } = await import("@/lib/discord.server");
        if (!(await isOwner())) return json(401, { error: "Session expirée : reconnectez-vous." });
        try {
          const { readConsoleState } = await import("@/lib/console-state.server");
          return json(200, await readConsoleState());
        } catch {
          return json(500, { error: "Lecture impossible pour le moment. Réessayez dans quelques secondes." });
        }
      },
    },
  },
});
