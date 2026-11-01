import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Activity, Users, Hash, Shield, Sparkles, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getServerAnalytics } from "@/lib/server-analytics.functions";
import { summarizeAudit } from "@/lib/server-analytics";
import { cn } from "@/lib/utils";

const number = (v: number | null) => v === null ? "—" : v.toLocaleString("fr-FR");
const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--popover-foreground)" };

export function ServerAnalytics({ guildId }: { guildId: string }) {
  const fetchAnalytics = useServerFn(getServerAnalytics);
  const [days, setDays] = useState(7);
  const query = useQuery({ queryKey: ["discord", "analytics", guildId], queryFn: () => fetchAnalytics({ data: { guildId } }), staleTime: 60_000, retry: false });
  const data = query.data;
  const summary = data?.audit ? summarizeAudit(data.audit, days, new Date(data.fetchedAt).getTime()) : null;
  const latest = data?.audit?.filter((e) => summary?.entries.some((s) => s.id === e.id)).slice(0, 8) ?? [];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Analyses du serveur</h2>
          <p className="mt-1 text-sm text-muted-foreground">{data?.name ?? "Vue d’ensemble"}{data && ` · ${new Date(data.fetchedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`}</p>
        </div>
        <Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} />Actualiser</Button>
      </div>
      {query.isPending && <div role="status" className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Chargement des statistiques…</div>}
      {query.error && <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{query.error instanceof Error ? query.error.message : "Statistiques indisponibles. Réessayez."}</p>}
      {data && <>
        {data.warnings.map((warning) => <p key={warning} role="status" className="flex items-start gap-2 border-l-2 border-chart-3 pl-3 text-sm text-muted-foreground"><AlertCircle className="h-4 w-4 shrink-0 text-chart-3" />{warning}</p>)}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { label: "Membres", value: data.members, note: "Estimation Discord", icon: Users, color: "text-chart-1" },
            { label: "Non hors ligne", value: data.online, note: "Estimation Discord", icon: Activity, color: "text-chart-2" },
            { label: "Salons", value: data.channels, note: "Hors fils de discussion", icon: Hash, color: "text-chart-3" },
            { label: "Rôles", value: data.roles, note: "Hors @everyone", icon: Shield, color: "text-chart-5" },
          ].map((metric) => <div key={metric.label} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{metric.label}</span><metric.icon className={cn("h-4 w-4 shrink-0", metric.color)} /></div>
            <p className="mt-3 break-words text-3xl font-semibold tabular-nums">{number(metric.value)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p>
          </div>)}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-y border-border py-4 text-sm">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-chart-5" />{number(data.boosts)} boosts · niveau {number(data.boostTier)}</span>
          <span className="flex items-center gap-2"><Shield className="h-4 w-4 text-chart-2" />Vérification : {data.verification === null ? "—" : ["Aucune", "Faible", "Moyenne", "Élevée", "Très élevée"][data.verification] ?? "Inconnue"}</span>
        </div>
        <section aria-label="Répartition des salons">
          <h3 className="mb-4 font-semibold">Répartition des salons</h3>
          {data.channelGroups ? <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <div className="h-56 min-w-0" role="img" aria-label={data.channelGroups.map((g) => `${g.name} : ${g.count}`).join(", ")}>
              <ResponsiveContainer width="100%" height="100%"><BarChart data={data.channelGroups} layout="vertical" margin={{ left: 5, right: 20 }}><XAxis type="number" allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} /><YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number) => [v, "Salons"]} /><Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>{data.channelGroups.map((g) => <Cell key={g.name} fill={g.fill} />)}</Bar></BarChart></ResponsiveContainer>
            </div>
            <dl className="divide-y divide-border">{data.channelGroups.map((g) => <div key={g.name} className="flex items-center justify-between gap-3 py-3 text-sm"><dt className="text-muted-foreground">{g.name}</dt><dd className="font-mono font-medium">{number(g.count)}</dd></div>)}</dl>
          </div> : <p className="text-sm text-muted-foreground">Répartition indisponible.</p>}
        </section>
        <section className="border-t border-border pt-6" aria-label="Activité administrative">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Activité administrative</h3>
            <div className="flex gap-1" aria-label="Période">{[7, 30].map((period) => <Button key={period} variant={days === period ? "secondary" : "ghost"} size="sm" aria-pressed={days === period} onClick={() => setDays(period)}>{period} jours</Button>)}</div>
          </div>
          <p className="text-xs text-muted-foreground">Échantillon des {data.audit?.length ?? "—"} dernières actions du journal Discord · jours UTC{data.auditCapped ? " · limité à 100 actions, période potentiellement incomplète" : ""}.</p>
          {summary ? <>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{[{ label: "Actions relevées", value: summary.actions }, { label: "Bannissements", value: summary.bans }, { label: "Expulsions", value: summary.kicks }, { label: "Actions de suppression", value: summary.deletions }].map((m) => <div key={m.label}><p className="text-2xl font-semibold tabular-nums">{number(m.value)}</p><p className="mt-1 text-xs text-muted-foreground">{m.label}</p></div>)}</div>
            <div className="mt-5 h-56 min-w-0" role="img" aria-label={`${summary.actions} actions relevées sur ${days} jours`}>
              <ResponsiveContainer width="100%" height="100%"><BarChart data={summary.buckets} margin={{ left: -20, right: 8 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tickFormatter={(v: string) => `${v.slice(8)}/${v.slice(5, 7)}`} stroke="var(--muted-foreground)" fontSize={11} minTickGap={24} /><YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number) => [v, "Actions"]} /><Bar dataKey="actions" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={32} /></BarChart></ResponsiveContainer>
            </div>
            {summary.actions === 0 && <p className="mt-2 text-sm text-muted-foreground">Aucune action relevée dans cet échantillon sur la période.</p>}
            {latest.length > 0 && <><h4 className="mb-2 mt-6 text-sm font-medium">Dernières actions relevées</h4><ul className="divide-y divide-border">{latest.map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm"><span className="min-w-36 flex-1 font-medium">{entry.action}</span><span className="max-w-full break-words text-muted-foreground">{entry.by}</span><time className="text-xs text-muted-foreground" dateTime={entry.date}>{new Date(entry.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</time></li>)}</ul></>}
          </> : <p className="py-8 text-sm text-muted-foreground">Activité administrative indisponible.</p>}
        </section>
      </>}
    </div>
  );
}