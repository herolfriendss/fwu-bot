import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Coins, Crown, Gamepad2, RefreshCw, ShoppingBag, Wallet } from "lucide-react";
import { getEconomySnapshots } from "@/lib/economy.functions";
import { ECONOMY_STALE_MS, economySnapshotAge, formatPnd } from "@/lib/economy";
import { Button } from "@/components/ui/button";

const economyQuery = queryOptions({
  queryKey: ["bot-economy-snapshots"],
  queryFn: () => getEconomySnapshots(),
  refetchInterval: 60_000,
  staleTime: 0,
});

export const Route = createFileRoute("/economie")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Économie PND — Her? V4" },
    { name: "description", content: "Soldes, classement et boutique PND synchronisés depuis le bot Oracle." },
    { property: "og:title", content: "Économie PND — Her? V4" },
    { property: "og:description", content: "Aperçu privé de l’économie PND du bot Discord." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(economyQuery),
  component: EconomyPage,
});

function ageLabel(capturedAt: string, now: number): string {
  const age = economySnapshotAge(capturedAt, now);
  if (age === null) return "date inconnue";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

function EconomyPage() {
  const [now, setNow] = useState(0);
  const q = useSuspenseQuery(economyQuery);
  const snapshots = q.data;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const current = snapshots.find((s) => s.guildId === selected) ?? snapshots[0] ?? null;
  const stale = current && now ? Date.parse(current.capturedAt) < now - ECONOMY_STALE_MS : false;

  return <div className="console-shell bg-background">
    <header className="console-header border-b border-border p-4 md:p-8"><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
      <Button asChild variant="ghost" size="icon"><Link to="/configuration" aria-label="Retour à la configuration"><ArrowLeft className="h-5 w-5" /></Link></Button>
      <h1 className="flex flex-1 items-center gap-2 text-xl font-semibold"><Coins className="h-5 w-5 text-primary" /> Économie PND</h1>
      {snapshots.length > 1 && (
        <select aria-label="Serveur" value={current?.guildId ?? ""} onChange={(e) => setSelected(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          {snapshots.map((s) => <option key={s.guildId} value={s.guildId}>{s.guildName ?? s.guildId}</option>)}
        </select>
      )}
      <Button variant="outline" size="icon" aria-label="Actualiser" title="Actualiser" disabled={q.isFetching} onClick={() => q.refetch()}>
        <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
      </Button>
    </div></header>

    <main className="console-content mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      {q.isRefetchError && <p role="alert" className="text-destructive">Actualisation impossible : les dernières données reçues sont affichées.</p>}
      {!current && (
        <section className="border border-border bg-card p-6">
          <h2 className="font-semibold">Aucun instantané PND reçu</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Les soldes apparaîtront après la mise à jour du bot Oracle et sa prochaine synchronisation (environ 5 minutes).
            La base SQLite du bot reste la source de vérité : ce panneau ne fait que l’afficher.
          </p>
        </section>
      )}

      {current && <>
        <section className="border-b border-border pb-8">
          <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h2 className="text-xl font-semibold">{current.guildName ?? current.guildId}</h2>
            <p className={`text-sm ${stale ? "text-destructive" : "text-muted-foreground"}`} role="status">
              Instantané {now ? ageLabel(current.capturedAt, now) : "…"}{stale ? " · synchronisation en retard" : ""}
            </p>
          </div>
          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <Stat icon={Coins} label="Masse totale" value={formatPnd(current.totalBalance)} />
            <Stat icon={Wallet} label="Portefeuilles" value={current.walletCount.toLocaleString("fr-FR")} />
            <Stat icon={RefreshCw} label="Mouvements" value={current.ledgerCount.toLocaleString("fr-FR")} />
            <Stat icon={Crown} label="Daily réclamés" value={current.dailyClaims.toLocaleString("fr-FR")} />
            <Stat icon={Gamepad2} label="Parties en cours" value={current.activeGames.toLocaleString("fr-FR")} />
          </dl>
        </section>

        <section>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Crown className="h-4 w-4 text-primary" /> Classement des soldes</h2>
          <p className="mb-4 text-xs text-muted-foreground">10 plus gros portefeuilles du serveur.</p>
          {current.topWallets.length === 0
            ? <p className="text-sm text-muted-foreground">Aucun solde positif enregistré.</p>
            : <ol className="divide-y divide-border border-y border-border">
              {current.topWallets.map((wallet, index) => (
                <li key={wallet.userId} className="flex items-center gap-4 py-3 text-sm">
                  <span className="w-6 font-mono text-xs text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{wallet.displayName ?? `<@${wallet.userId}>`}</span>
                  <span className="font-mono text-xs text-muted-foreground">{wallet.userId}</span>
                  <span className="w-32 text-right font-medium">{formatPnd(wallet.balance)}</span>
                </li>
              ))}
            </ol>}
        </section>

        <section>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><ShoppingBag className="h-4 w-4 text-primary" /> Boutique PND</h2>
          <p className="mb-4 text-xs text-muted-foreground">Rôles actuellement en vente ({current.shopItems.length}).</p>
          {current.shopItems.length === 0
            ? <p className="text-sm text-muted-foreground">La boutique est vide.</p>
            : <ul className="divide-y divide-border border-y border-border">
              {current.shopItems.map((item) => (
                <li key={item.roleId} className="flex items-center gap-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item.roleName ?? `<@&${item.roleId}>`}</span>
                  <span className="font-mono text-xs text-muted-foreground">{item.roleId}</span>
                  <span className="w-32 text-right font-medium">{formatPnd(item.price)}</span>
                </li>
              ))}
            </ul>}
        </section>
      </>}
    </main>
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) {
  return <div>
    <dt className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</dt>
    <dd className="mt-2 text-lg font-semibold">{value}</dd>
  </div>;
}
