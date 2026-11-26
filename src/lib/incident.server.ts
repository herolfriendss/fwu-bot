import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { discord } from "./discord.server";
import { aiErrorMessage, formatAuditEntry, type AuditEntry, type IncidentEvent } from "./incident-shared";

const MODEL = "openai/gpt-6-astra";

const INSTRUCTIONS = `Tu es un conseiller en modération pour un serveur Discord francophone.
L'administrateur décrit un incident et fournit le journal récent des actions de modération du serveur.
Analyse le journal pour repérer les antécédents des personnes impliquées (sanctions, sourdines, messages supprimés) et la façon dont des cas similaires ont été traités.
Réponds en français, en Markdown, avec exactement ces sections et dans cet ordre :
## Analyse
## Antécédents dans le journal
## Réponse recommandée
(Une seule action principale parmi : aucune action, avertissement, sourdine avec durée précise, expulsion, bannissement. Justifie-la de façon proportionnée et graduée.)
## Message suggéré au membre
(Court, respectueux, prêt à copier.)
## Mesures préventives
Si le journal ne contient rien de pertinent pour les personnes citées, dis-le clairement. N'invente jamais d'actions absentes du journal. Sois concis.`;

async function buildJournal(guildId: string): Promise<string> {
  try {
    const log = await discord<{ audit_log_entries: AuditEntry[]; users: { id: string; username: string }[] }>(
      `guilds/${guildId}/audit-logs?limit=50`,
    );
    const names = new Map(log.users.map((u) => [u.id, u.username]));
    const lines = log.audit_log_entries.map((e) => formatAuditEntry(e, names));
    return lines.length ? lines.join("\n") : "Journal vide : aucune action récente.";
  } catch {
    return "Journal indisponible : le bot n'a pas la permission « Voir les logs du serveur ».";
  }
}

async function buildTimeouts(guildId: string): Promise<string> {
  try {
    const members = await discord<{ user: { username: string }; nick?: string | null; communication_disabled_until?: string | null }[]>(
      `guilds/${guildId}/members?limit=1000`,
    );
    const now = Date.now();
    const muted = members
      .filter((m) => m.communication_disabled_until && new Date(m.communication_disabled_until).getTime() > now)
      .map((m) => `${m.nick || m.user.username} (jusqu'au ${m.communication_disabled_until!.slice(0, 16).replace("T", " ")} UTC)`);
    return muted.length ? muted.join(", ") : "aucun";
  } catch {
    return "inconnu";
  }
}

const encoder = new TextEncoder();

/**
 * Streams the analysis as NDJSON events. HTTP status is always 200 once the
 * stream starts; failures arrive as a terminal { type: "error" } event.
 */
export function streamIncidentAnalysis(request: Request, guildId: string, description: string): Response {
  const apiKey = process.env["LOVABLE_API_KEY"];

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: IncidentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        if (!apiKey) {
          send({ type: "error", message: aiErrorMessage(401) });
          return;
        }
        send({ type: "status", step: "journal" });
        const [journal, timeouts] = await Promise.all([buildJournal(guildId), buildTimeouts(guildId)]);
        if (request.signal.aborted) return;

        let runId: string | undefined;
        const provider = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey,
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: async (input, init) => {
            const headers = new Headers(init?.headers);
            if (runId) headers.set("X-Lovable-AIG-Run-ID", runId);
            const res = await fetch(input, { ...init, headers });
            runId ??= res.headers.get("X-Lovable-AIG-Run-ID") ?? undefined;
            return res;
          },
        });

        send({ type: "status", step: "thinking" });
        const result = streamText({
          model: provider.responses(MODEL),
          instructions: INSTRUCTIONS,
          messages: [
            {
              role: "user",
              content:
                `Incident décrit par l'administrateur :\n${description}\n\n` +
                `Membres actuellement en sourdine : ${timeouts}\n\n` +
                `Journal des actions de modération (du plus récent au plus ancien) :\n${journal}`,
            },
          ],
          maxRetries: 0,
          abortSignal: request.signal,
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "medium",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
        });

        let wroteText = false;
        let failed = false;
        for await (const part of result.stream) {
          if (part.type === "reasoning-delta" && part.text) send({ type: "reasoning", text: part.text });
          else if (part.type === "text-delta" && part.text) {
            if (!wroteText) {
              wroteText = true;
              send({ type: "status", step: "writing" });
            }
            send({ type: "text", text: part.text });
          } else if (part.type === "error") {
            failed = true;
            const status = (part.error as { statusCode?: number })?.statusCode;
            console.error("Incident analysis failed", status, part.error);
            send({ type: "error", message: aiErrorMessage(status) });
            break;
          } else if (part.type === "abort") {
            return;
          }
        }
        if (failed) return;
        if (!wroteText) {
          send({ type: "error", message: "Le modèle n'a fourni aucune réponse pour cet incident." });
          return;
        }
        send({ type: "done" });
      } catch (e) {
        if (request.signal.aborted) return;
        const status = (e as { statusCode?: number })?.statusCode;
        console.error("Incident analysis failed", status, e);
        send({ type: "error", message: aiErrorMessage(status) });
      } finally {
        try {
          controller.close();
        } catch {
          // Stream already closed by the client.
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
