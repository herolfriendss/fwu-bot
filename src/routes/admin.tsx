import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Shield } from "lucide-react";
import { getOverview } from "@/lib/discord.functions";
import { VoiceAccessPanel } from "@/components/VoiceAccessPanel";
import { Button } from "@/components/ui/button";

const overviewQuery = queryOptions({ queryKey: ["discord", "overview"], queryFn: () => getOverview(), staleTime: 60_000 });
export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [
    { title: "Administration vocale — FWU" },
    { name: "description", content: "Gérez les rôles autorisés aux commandes /panel et /pv de votre bot Discord." },
    { property: "og:title", content: "Administration vocale — FWU" },
    { property: "og:description", content: "Administration propriétaire des accès aux commandes vocales Discord." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  component: Admin,
});
function Admin() {
  const { data } = useSuspenseQuery(overviewQuery);
  const [guildId, setGuildId] = useState(data.guilds[0]?.id ?? "");
  return <div className="min-h-screen bg-background">
    <header className="console-header border-b border-border px-4 py-5 md:px-8"><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
      <Button asChild variant="ghost" size="icon"><Link to="/configuration" aria-label="Retour à la configuration"><ArrowLeft className="h-5 w-5" /></Link></Button>
      <h1 className="flex flex-1 items-center gap-2 text-xl font-bold"><Shield className="h-5 w-5" /> Admin</h1>
      <select aria-label="Serveur" value={guildId} onChange={(e) => setGuildId(e.target.value)} className="max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{data.guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
    </div></header>
    <SiteNav />
    <main className="console-content mx-auto max-w-6xl p-4 md:p-8">{guildId ? <VoiceAccessPanel key={guildId} guildId={guildId} /> : <p className="text-muted-foreground">Le bot n’est sur aucun serveur.</p>}</main>
  </div>;
}