import { createFileRoute } from "@tanstack/react-router";

// Public, unauthenticated by design: returns only what buildPublicPage() allows, and only for a
// server whose owner switched the public page on. Everything else answers 404.
export const Route = createFileRoute("/api/public/vitrine/$guildId")({ server: { handlers: {
  GET: async ({ params }) => {
    const notFound = () => Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    if (!/^\d{5,25}$/.test(params.guildId)) return notFound();
    try {
      const { readPublicPage } = await import("@/lib/public-page.server");
      const page = await readPublicPage(params.guildId);
      if (!page) return notFound();
      return Response.json(page, { headers: { "Cache-Control": "public, max-age=300" } });
    } catch {
      return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  },
} } });
