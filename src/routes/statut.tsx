import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Activity, ArrowLeft, RefreshCw } from "lucide-react";
import { getDedicatedBotStatuses, getRuntimeStatus } from "@/lib/bot-status.functions";
import { BOT_PROFILES } from "@/lib/bot-profiles";
import { connectionState, EVENT_LABELS } from "@/lib/bot-status";
import { Button } from "@/components/ui/button";

const statusQuery = queryOptions({ queryKey: ["bot-runtime-status"], queryFn: () => getRuntimeStatus(), refetchInterval: 5_000, staleTime: 0 });
const botsQuery = queryOptions({ queryKey: ["fwu-dedicated-bots"], queryFn: () => getDedicatedBotStatuses(), refetchInterval: 15_000, staleTime: 0 });
export const Route = createFileRoute("/statut")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Statut des bots — FWU" }, { name: "description", content: "Connexion Discord, dernière synchronisation et journal du bot hébergé sur Oracle." },
    { property: "og:title", content: "Statut des bots — FWU" }, { property: "og:description", content: "Suivi privé de la connexion et des événements du bot Discord." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(statusQuery), component: StatusPage,
});
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—";
function StatusPage() {
  const [now, setNow] = useState(0);
  const q = useSuspenseQuery({ ...statusQuery, refetchOnMount: false, refetchInterval: now ? 5_000 : false });
  const bots = useQuery(botsQuery);
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(id); }, []);
  const state = now ? connectionState(q.data, now) : "unknown";
  const label = !now ? "Vérification…" : state === "online" ? "Connecté" : state === "offline" ? "Déconnecté" : "Aucun signal reçu";
  return <div className="console-shell bg-background">
    <header className="console-header border-b border-border p-4 md:p-8"><div className="mx-auto flex max-w-6xl items-center gap-4">
      <Button asChild variant="ghost" size="icon"><Link to="/configuration" aria-label="Retour à la configuration"><ArrowLeft className="h-5 w-5" /></Link></Button>
      <h1 className="flex flex-1 items-center gap-2 text-xl font-semibold"><Activity className="h-5 w-5 text-primary" /> Statut des bots</h1>
      <Button variant="outline" size="icon" aria-label="Actualiser" title="Actualiser" disabled={q.isFetching} onClick={() => q.refetch()}><RefreshCw className="h-4 w-4" /></Button>
    </div></header>
    <main className="console-content mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      {q.isRefetchError && <p role="alert" className="text-destructive">Actualisation impossible : les dernières données reçues sont affichées.</p>}
      <section className="border-b border-border pb-8">
        <p className="mb-5 flex items-center gap-3 text-2xl font-semibold" role="status"><span className={`h-3 w-3 shrink-0 rounded-full ${state === "online" ? "bg-signal" : state === "offline" ? "bg-destructive" : "bg-muted-foreground"}`} />{label}</p>
        <dl className="grid gap-6 sm:grid-cols-3">
          <div><dt className="text-sm text-muted-foreground">Dernier signal</dt><dd className="mt-2 text-sm">{date(q.data?.lastSeen)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Dernière synchronisation</dt><dd className="mt-2 text-sm">{date(q.data?.lastSync)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Démarrage du processus</dt><dd className="mt-2 text-sm">{date(q.data?.startedAt)}</dd></div>
        </dl>
        {!q.data && <p className="mt-6 text-sm text-muted-foreground">La version du bot sur Oracle doit être mise à jour pour transmettre son statut.</p>}
        {state === "offline" && <p className="mt-6 text-sm text-muted-foreground">Le bot signale une déconnexion ou n’a plus transmis de signal depuis plus de 70 secondes.</p>}
      </section>
      <section className="border-b border-border pb-8">
        <h2 className="mb-4 text-lg font-semibold">Les autres bots</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["guard", "fdpdlavoc", "suckme", "fisc"] as const).map((id) => {
            const bot = bots.data?.[id] ?? null;
            const botState = !now || !bot ? "unknown" : bot.connected && now - Date.parse(bot.lastSeen) <= 70_000 ? "online" : "offline";
            return <li key={id} className="rounded-md border border-border p-3">
              <p className="flex items-center gap-2 font-medium"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${botState === "online" ? "bg-signal" : botState === "offline" ? "bg-destructive" : "bg-muted-foreground"}`} />{BOT_PROFILES[id].label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{botState === "online" ? "En ligne" : bot ? `Hors ligne depuis le ${date(bot.lastSeen)}` : "Jamais connecté : aucun signal reçu pour l’instant"}</p>
              <p className="mt-2 text-xs text-muted-foreground">{BOT_PROFILES[id].summary}</p>
            </li>;
          })}
        </ul>
      </section>
      <section><h2 className="mb-4 text-lg font-semibold">Journal du processus</h2><p className="mb-4 text-xs text-muted-foreground">50 derniers événements transmis · sans messages Discord ni données sensibles</p>
        {q.data?.events.length ? <ul className="divide-y divide-border">{[...q.data.events].reverse().map((e, i) => <li key={`${e.at}-${i}`} className="flex flex-wrap gap-x-6 gap-y-2 py-3 text-sm"><time className="font-mono text-xs text-muted-foreground">{date(e.at)}</time><span className={e.code.endsWith("error") ? "text-destructive" : "text-foreground"}>{EVENT_LABELS[e.code]}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun événement reçu.</p>}
      </section>
    </main>
  </div>;
}