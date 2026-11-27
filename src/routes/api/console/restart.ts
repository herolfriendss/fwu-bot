import { createFileRoute } from "@tanstack/react-router";
import { parseRestartRequest } from "@/lib/bot-control";
import { readBoundedText } from "@/lib/http-body";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Redémarrage individuel d'un bot depuis la console. Réservé à l'OWNER connecté.
// Défense CSRF : cookie SameSite=Lax, en-tête personnalisé obligatoire (impossible à envoyer depuis un autre site
// sans autorisation CORS, que ce site n'accorde pas), JSON obligatoire et refus d'une requête déclarée inter-sites.
export const Route = createFileRoute("/api/console/restart")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isOwner, configuredPndOwners } = await import("@/lib/discord.server");
        if (!(await isOwner())) return json(401, { error: "Session expirée : reconnectez-vous." });

        const site = request.headers.get("sec-fetch-site");
        if (site && site !== "same-origin" && site !== "none") return json(403, { error: "Requête refusée." });
        if (request.headers.get("x-console-action") !== "restart") return json(403, { error: "Requête refusée." });
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "Format attendu : JSON." });

        const text = await readBoundedText(request, 512);
        if (text === null) return json(413, { error: "Requête trop grande." });
        let input: unknown;
        try { input = JSON.parse(text); } catch { return json(400, { error: "JSON invalide." }); }
        const parsed = parseRestartRequest(input);
        if (!parsed) return json(400, { error: "Bot inconnu." });

        const actorId = configuredPndOwners()[0] ?? null;
        if (!actorId) return json(500, { error: "OWNER non configuré." });
        try {
          const { requestRestart } = await import("@/lib/bot-control.server");
          const result = await requestRestart(parsed.bot, actorId);
          if (result.ok) return json(202, { ok: true, command: result.command });
          if (result.reason === "cooldown") return json(429, { error: `Un redémarrage vient d’être demandé. Réessayez dans ${result.retryInSeconds} s.`, retryInSeconds: result.retryInSeconds });
          if (result.reason === "already-pending") return json(409, { error: "Un redémarrage est déjà en attente pour ce bot." });
          return json(409, { error: "Ce bot ne transmet plus son statut : il ne peut pas lire l’ordre. Relancez-le avec PM2 (pm2 restart <nom>)." });
        } catch {
          return json(500, { error: "Impossible d’enregistrer l’ordre. Vérifiez que la migration bot_control_commands est appliquée." });
        }
      },
    },
  },
});
