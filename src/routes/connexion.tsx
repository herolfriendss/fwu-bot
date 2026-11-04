import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Lock } from "lucide-react";
import { login } from "@/lib/discord.functions";

export const Route = createFileRoute("/connexion")({
  head: () => ({
    meta: [
      { title: "Connexion — Her? V4" },
      { name: "description", content: "Espace réservé au propriétaire du bot Discord." },
      { property: "og:title", content: "Connexion — Her? V4" },
      { property: "og:description", content: "Espace réservé au propriétaire du bot Discord." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Connexion,
});

function Connexion() {
  const router = useRouter();
  const doLogin = useServerFn(login);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    try {
      const { ok } = await doLogin({ data: { password } });
      if (ok) await router.navigate({ to: "/" });
      else setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent shadow-glow">
          <Lock className="h-5 w-5 text-accent-foreground" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Espace propriétaire</h1>
        <p className="mt-1 text-sm text-muted-foreground">Entrez votre mot de passe pour gérer le bot.</p>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          placeholder="Mot de passe"
          className="mt-5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="mt-2 text-sm text-destructive">Mot de passe incorrect.</p>}
        <button
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
        >
          {busy ? "Vérification…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
