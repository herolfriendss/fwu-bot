import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Coins, Crown, Rocket, Terminal, Users } from "lucide-react";
import type { PublicPage } from "@/lib/public-page";
import { formatPnd } from "@/lib/economy";

// Public showcase page: no owner session, data only from /api/public/vitrine (opt-in per server).
export const Route = createFileRoute("/serveur/$guildId")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Le serveur — FWU" },
    { name: "description", content: "Membres, bots, classement et commandes du serveur." },
    { property: "og:title", content: "Le serveur — FWU" },
    { property: "og:type", content: "website" },
  ] }),
  component: PublicServerPage,
});

const number = (value: number | null) => (value === null ? "—" : value.toLocaleString("fr-FR"));

function PublicServerPage() {
  const { guildId } = Route.useParams();
  const q = useQuery({
    queryKey: ["public-page", guildId],
    queryFn: async (): Promise<PublicPage | null> => {
      const res = await fetch(`/api/public/vitrine/${encodeURIComponent(guildId)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Page momentanément indisponible. Réessaie dans quelques minutes.");
      return res.json() as Promise<PublicPage>;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (q.isLoading) return <Shell><p className="text-muted-foreground">Chargement…</p></Shell>;
  if (q.error) return <Shell><p className="text-destructive">{q.error.message}</p></Shell>;
  if (!q.data) return <Shell><h1 className="text-xl font-semibold">Page introuvable</h1><p className="mt-2 text-sm text-muted-foreground">Ce serveur n’a pas de page publique.</p></Shell>;
  const p = q.data;

  return (
    <Shell>
      <header className="flex items-center gap-4">
        {p.iconUrl ? <img src={p.iconUrl} alt="" className="h-16 w-16 rounded-2xl" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent"><Users className="h-7 w-7" /></div>}
        <div><h1 className="text-2xl font-bold">{p.name}</h1><p className="text-sm text-muted-foreground">Propulsé par les bots FWU</p></div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Users} label="Membres" value={number(p.members)} />
        <Stat icon={Users} label="En ligne" value={number(p.online)} />
        <Stat icon={Rocket} label="Boosts" value={p.boosts === null ? "—" : `${number(p.boosts)}${p.boostTier ? ` · niveau ${p.boostTier}` : ""}`} />
      </section>

      <section className="console-theme-panel space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4" /> Les bots</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {p.bots.map((b) => (
            <li key={b.id} className="console-glass-tile p-3">
              <p className="flex items-center gap-2 font-medium"><span className={`h-2.5 w-2.5 rounded-full ${b.online ? "bg-signal" : "bg-muted-foreground"}`} />{b.label}<span className="text-xs font-normal text-muted-foreground">{b.online ? "en ligne" : "hors ligne"}</span></p>
              <p className="mt-1 text-xs text-muted-foreground">{b.summary}</p>
            </li>
          ))}
        </ul>
      </section>

      {p.activity && (
        <section className="console-theme-panel space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Crown className="h-4 w-4" /> Classement XP</h2>
          <p className="text-sm text-muted-foreground">{number(p.activity.rankedMembers)} membres classés · {number(p.activity.messages30)} messages ces 30 derniers jours</p>
          {p.activity.xpLeaderboard?.length ? <ol className="space-y-1 text-sm">{p.activity.xpLeaderboard.map((m) => <li key={m.rank} className="flex justify-between gap-3"><span><span className="mr-2 font-mono text-muted-foreground">{m.rank}.</span>{m.name}</span><span className="font-mono">niveau {m.level}</span></li>)}</ol> : null}
        </section>
      )}

      {p.economy && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="console-theme-panel space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Crown className="h-4 w-4" /> Classement PND</h2>
            {p.economy.leaderboard?.length ? (
              <ol className="space-y-1 text-sm">{p.economy.leaderboard.map((w) => <li key={w.rank} className="flex justify-between gap-3"><span><span className="mr-2 font-mono text-muted-foreground">{w.rank}.</span>{w.name}</span><span className="font-mono">{formatPnd(w.balance)}</span></li>)}</ol>
            ) : <p className="text-sm text-muted-foreground">{formatPnd(p.economy.totalBalance)} en circulation entre {number(p.economy.walletCount)} portefeuilles.</p>}
          </div>
          <div className="console-theme-panel space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Coins className="h-4 w-4" /> Boutique</h2>
            {p.economy.shop.length ? <ul className="space-y-1 text-sm">{p.economy.shop.map((item, i) => <li key={i} className="flex justify-between gap-3"><span>{item.name}</span><span className="font-mono">{formatPnd(item.price)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">La boutique est vide pour l’instant.</p>}
          </div>
        </section>
      )}

      <section className="console-theme-panel space-y-4 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Terminal className="h-4 w-4" /> Commandes pour tous</h2>
        {p.commands.map((group) => (
          <div key={group.category}>
            <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">{group.category}</h3>
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{group.items.map((c) => <li key={c.name}><code className="font-mono">/{c.name}</code> <span className="text-muted-foreground">· {c.description} ({c.bot})</span></li>)}</ul>
          </div>
        ))}
      </section>
      <p className="text-center text-xs text-muted-foreground">Mis à jour le {new Date(p.generatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="console-shell bg-background"><main className="mx-auto max-w-4xl space-y-6 p-4 md:p-10">{children}</main></div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <div className="console-glass-tile p-4"><p className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</p><p className="mt-2 font-mono text-2xl">{value}</p></div>;
}
