import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/connexion")({
  head: () => ({
    meta: [
      { title: "Connexion — Console" },
      { name: "description", content: "Connexion sécurisée des propriétaires PND." },
      { property: "og:title", content: "Connexion — FWU V2" },
      { property: "og:description", content: "Espace réservé aux deux propriétaires PND." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // An optional key (not a key holding undefined) means links to /connexion need no search param.
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search["error"] === "string" ? { error: search["error"] } : {},
  component: Connexion,
});

function Connexion() {
  const { error } = Route.useSearch();
  const message = error === "discord_denied"
    ? "La connexion Discord a été annulée."
    : error
      ? "Connexion impossible. Vérifie la configuration OAuth et réessaie."
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <section className="w-full max-w-sm border border-white/80 p-8">
        <div className="mb-8 flex items-center gap-3">
          <span aria-hidden className="inline-block h-9 w-9 rounded-full border-2 border-white" />
          <span className="text-sm tracking-[0.3em] text-white/70">CONSOLE</span>
        </div>
        <h1 className="text-5xl font-bold leading-none tracking-tight">fwu</h1>
        <p className="mt-4 text-sm text-white/60">Accès réservé à l’owner. Connexion avec Discord.</p>
        {message && <p role="alert" className="mt-6 border border-white/40 p-3 text-sm text-white">{message}</p>}
        <a
          href="/api/auth/discord/start"
          className="mt-8 flex w-full items-center justify-center border border-white bg-white px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Se connecter avec Discord
        </a>
      </section>
    </main>
  );
}
