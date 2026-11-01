import { createFileRoute } from "@tanstack/react-router";

const fail = (status: number, message: string) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/discord-interactions")({
  server: {
    handlers: {
      // Public by design: the caller is Discord itself, verified with the Ed25519
      // signature of the application, not with the owner session cookie.
      POST: async ({ request }) => {
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(415, "Expected application/json");
        const body = await request.text();
        if (body.length > 100_000) return fail(413, "Payload too large");
        const { getVerifyKey, verifySignature, handleInteraction, claimInteraction } = await import("@/lib/discord-interactions.server");
        const key = await getVerifyKey().catch(() => null);
        const signature = request.headers.get("x-signature-ed25519") ?? "";
        const timestamp = request.headers.get("x-signature-timestamp") ?? "";
        if (!key || !verifySignature(key, signature, timestamp, body)) return fail(401, "Invalid request signature");
        let interaction: unknown;
        try {
          interaction = JSON.parse(body);
        } catch {
          return fail(400, "Invalid JSON");
        }
        const interactionId = typeof interaction === "object" && interaction !== null && "id" in interaction
          ? String((interaction as { id?: unknown }).id ?? "")
          : "";
        try {
          if (!await claimInteraction(interactionId)) return fail(409, "Duplicate interaction");
        } catch {
          return fail(503, "Interaction protection unavailable");
        }
        return Response.json(await handleInteraction(interaction), { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
