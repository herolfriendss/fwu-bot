import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";

export const Route = createFileRoute("/connexion")({
  head: () => ({
    meta: [
      { title: "Connexion — FWU" },
      { name: "description", content: "Connexion sécurisée des propriétaires PND." },
      { property: "og:title", content: "Connexion — FWU" },
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent shadow-glow">
          <LockKeyhole className="h-5 w-5 text-accent-foreground" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Espace propriétaire</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connecte-toi avec l’un des deux comptes Discord propriétaires de PND.
        </p>
        {message && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{message}</p>}
        <a
          href="/api/auth/discord/start"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
        >
          Se connecter avec Discord
        </a>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Accès réservé aux deux identifiants Discord configurés côté serveur.
        </p>
      </section>
    </main>
  );
}
