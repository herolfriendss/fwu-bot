import { createFileRoute } from "@tanstack/react-router";
import { readBoundedText } from "@/lib/http-body";
import { authorityDecisionInputSchema } from "@/lib/authority-console";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// AUTHORITY in the console: OWNER only (session cookie). Reading shows the bot's mirror; a
// decision is queued and applied by the bot with the same checks as on Discord.
export const Route = createFileRoute("/api/console/authority")({
  server: {
    handlers: {
      GET: async () => {
        const { isOwner } = await import("@/lib/discord.server");
        if (!(await isOwner())) return json(401, { error: "Session expirée : reconnectez-vous." });
        try {
          const { readAuthorityConsole } = await import("@/lib/authority-console.server");
          return json(200, await readAuthorityConsole());
        } catch (error) {
          return json(500, { error: error instanceof Error ? error.message : "Lecture impossible." });
        }
      },
      POST: async ({ request }) => {
        const { isOwner, configuredPndOwners } = await import("@/lib/discord.server");
        if (!(await isOwner())) return json(401, { error: "Session expirée : reconnectez-vous." });
        const site = request.headers.get("sec-fetch-site");
        if (site && site !== "same-origin" && site !== "none") return json(403, { error: "Requête refusée." });
        if (request.headers.get("x-console-action") !== "authority") return json(403, { error: "Requête refusée." });
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "Format attendu : JSON." });
        const text = await readBoundedText(request, 1024);
        if (text === null) return json(413, { error: "Requête trop grande." });
        let input: unknown;
        try { input = JSON.parse(text); } catch { return json(400, { error: "JSON invalide." }); }
        const parsed = authorityDecisionInputSchema.safeParse(input);
        if (!parsed.success) return json(400, { error: "Décision invalide." });
        if ((parsed.data.action === "approve" || parsed.data.action === "refuse") && !parsed.data.nonce) return json(400, { error: "Décision expirée : actualisez la page." });
        if (parsed.data.action === "extend" && !parsed.data.durationHours) return json(400, { error: "Indiquez la prolongation en heures." });
        const { queueAuthorityDecision } = await import("@/lib/authority-console.server");
        const result = await queueAuthorityDecision(parsed.data, configuredPndOwners()[0] ?? null);
        return result.ok ? json(202, { ok: true, message: "Décision envoyée : le bot l'applique dans la minute." }) : json(409, { error: result.error });
      },
    },
  },
});
