import { createFileRoute, useRouter, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Hash, Send, Server, RefreshCw, Bot, LogOut, Settings, Coins, Activity } from "lucide-react";
import { getOverview, logout, getChannels, getMessages, sendMessage } from "@/lib/discord.functions";
import { Button } from "@/components/ui/button";

const overviewQuery = queryOptions({
  queryKey: ["discord", "overview"],
  queryFn: () => getOverview(),
  staleTime: 60_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — FWU" },
      { name: "description", content: "Suivez vos serveurs, lisez les salons et envoyez des messages avec votre bot Discord FWU." },
      { property: "og:title", content: "Tableau de bord — FWU" },
      { property: "og:description", content: "Serveurs, salons et messages de votre bot Discord en un coup d'œil." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  component: Dashboard,
  errorComponent: DashboardError,
});

const iconUrl = (kind: "icons" | "avatars", id: string, hash: string | null) =>
  hash ? `https://cdn.discordapp.com/${kind}/${id}/${hash}.png?size=96` : null;

function Dashboard() {
  const { data } = useSuspenseQuery(overviewQuery);
  const [guildId, setGuildId] = useState<string | null>(data.guilds[0]?.id ?? null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const fetchChannels = useServerFn(getChannels);
  const fetchMessages = useServerFn(getMessages);
  const post = useServerFn(sendMessage);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const router = useRouter();
  const doLogout = useServerFn(logout);
  async function onLogout() {
    await doLogout();
    qc.clear();
    router.navigate({ to: "/connexion", replace: true });
  }

  const channels = useQuery({
    queryKey: ["discord", "channels", guildId],
    queryFn: () => guildId ? fetchChannels({ data: { guildId } }) : Promise.resolve([]),
    enabled: !!guildId,
    staleTime: 60_000,
  });
  const messages = useQuery({
    queryKey: ["discord", "messages", channelId],
    queryFn: () => channelId ? fetchMessages({ data: { channelId } }) : Promise.resolve([]),
    enabled: !!channelId,
    staleTime: 30_000,
    retry: false,
  });

  const avatar = iconUrl("avatars", data.bot.id, data.bot.avatar);
  const guild = data.guilds.find((g) => g.id === guildId);
  const channel = channels.data?.find((c) => c.id === channelId);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!channelId || !text.trim()) return;
    setSending(true);
    try {
      await post({ data: { channelId, content: text } });
      setText("");
      toast.success("Message envoyé");
      qc.invalidateQueries({ queryKey: ["discord", "messages", channelId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'envoi");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="console-header border-b border-border px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-sidebar-surface">
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <Bot className="text-accent-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{data.bot.username}</h1>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-signal" /> Panneau de contrôle
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-medium text-primary">{data.guilds.length}</div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">serveurs</div>
          </div>
          <Button asChild variant="ghost" size="icon"><Link to="/statut" aria-label="Statut des bots" title="Statut des bots">
            <Activity className="h-5 w-5" />
          </Link></Button>
          <Button asChild variant="ghost" size="icon"><Link to="/economie" aria-label="Économie PND" title="Économie PND">
            <Coins className="h-5 w-5" />
          </Link></Button>
          <Button asChild variant="ghost" size="icon"><Link to="/configuration" aria-label="Configuration" title="Configuration">
            <Settings className="h-5 w-5" />
          </Link></Button>
          <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Se déconnecter" title="Se déconnecter">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="dashboard-workspace mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[180px_180px_minmax(0,1fr)] md:p-8">
        <section className="min-w-0 border border-border bg-sidebar p-2">
          <h2 className="px-2 py-2 text-xs uppercase tracking-wider text-muted-foreground">Serveurs</h2>
          {data.guilds.length === 0 && (
            <p className="px-2 pb-2 text-sm text-muted-foreground">Le bot n'est invité sur aucun serveur.</p>
          )}
          <ul className="flex gap-2 overflow-x-auto md:flex-col">
            {data.guilds.map((g) => {
              const ic = iconUrl("icons", g.id, g.icon);
              const active = g.id === guildId;
              return (
                <li key={g.id} className="shrink-0">
                   <Button variant="ghost"
                    onClick={() => { setGuildId(g.id); setChannelId(null); }}
                     aria-pressed={active}
                     className="console-nav-item px-2 text-left text-sm"
                  >
                    {ic ? <img src={ic} alt="" className="h-7 w-7 rounded-md" /> : <Server className="h-5 w-5 text-muted-foreground" />}
                    <span className="truncate">{g.name}</span>
                   </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="min-w-0 border border-border bg-sidebar p-2">
          <h2 className="truncate px-2 py-2 text-xs uppercase tracking-wider text-muted-foreground">
            Salons{guild ? ` · ${guild.name}` : ""}
          </h2>
          {channels.isLoading && <p className="px-2 text-sm text-muted-foreground">Chargement…</p>}
          {channels.error && <p className="px-2 text-sm text-destructive">{channels.error.message}</p>}
          <ul className="flex max-h-[60vh] gap-1 overflow-auto md:flex-col">
            {channels.data?.map((c) => (
              <li key={c.id} className="shrink-0">
                <Button variant="ghost"
                  onClick={() => setChannelId(c.id)}
                  aria-pressed={c.id === channelId}
                  className="console-nav-item px-2 text-left text-sm"
                >
                  <Hash className="h-4 w-4 shrink-0" />
                  <span className="truncate">{c.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex min-h-[520px] min-w-0 flex-col border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-1 font-semibold">
              <Hash className="h-4 w-4 text-muted-foreground" />
              {channel?.name ?? "Choisissez un salon"}
            </h2>
            {channelId && (
              <Button variant="ghost" size="icon" onClick={() => messages.refetch()} aria-label="Actualiser" title="Actualiser">
                <RefreshCw className={`h-4 w-4 ${messages.isFetching ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
          <div className="flex max-h-[55vh] flex-1 flex-col-reverse gap-3 overflow-auto p-4">
            {messages.error && <p className="text-sm text-destructive">Lecture impossible : {messages.error.message}</p>}
            {messages.data?.length === 0 && <p className="text-sm text-muted-foreground">Aucun message.</p>}
            {messages.data?.map((m) => (
              <div key={m.id} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs">
                  {m.author.avatar ? <img src={iconUrl("avatars", m.author.id, m.author.avatar) ?? undefined} alt="" /> : m.author.username[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold">{m.author.username}</span>
                    {m.author.bot && <span className="rounded bg-accent px-1 font-mono text-[10px] text-accent-foreground">BOT</span>}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {new Date(m.timestamp).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-secondary-foreground">{m.content || <em className="text-muted-foreground">(pièce jointe ou embed)</em>}</p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={onSend} className="flex gap-2 border-t border-border p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              disabled={!channelId || sending}
              placeholder={channel ? `Écrire dans #${channel.name}` : "Sélectionnez un salon"}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button type="submit"
              disabled={!channelId || sending || !text.trim()}
              className="h-10 px-3"
            >
              <Send className="h-4 w-4" /> Envoyer
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}

function DashboardError({ error }: ErrorComponentProps) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">Impossible de joindre Discord</h1>
        <p className="text-sm text-muted-foreground">
          Le tableau de bord n'a pas pu charger les informations du bot. Réessaie dans quelques secondes.
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => router.invalidate()}>Réessayer</Button>
          <Button variant="outline" asChild>
            <Link to="/connexion">Connexion</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
