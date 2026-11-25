import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Crown, Hash, Sparkles, UserMinus, UserPlus, Users } from "lucide-react";
import { getActivitySnapshot } from "@/lib/activity.functions";
import { ACTIVITY_STALE_MS, activityTotals, fillActivityDays, type ActivityDay } from "@/lib/activity";

const n = (value: number) => value.toLocaleString("fr-FR");
// Days are UTC days, as stored by the bot (analytics_daily).
const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export function ActivityPanel({ guildId }: { guildId: string }) {
  const fetchActivity = useServerFn(getActivitySnapshot);
  const q = useQuery({ queryKey: ["activity", guildId], queryFn: () => fetchActivity({ data: { guildId } }), staleTime: 60_000 });

  if (q.isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (q.error) return <p className="text-destructive">{q.error.message}</p>;
  const a = q.data;
  if (!a) return (
    <section className="console-theme-panel space-y-2 p-4">
      <h3 className="font-semibold">Aucune donnée d’activité reçue</h3>
      <p className="text-sm text-muted-foreground">Le bot FWU envoie l’XP et l’activité toutes les 15 minutes. Si rien n’apparaît, la version du bot sur le VPS doit être mise à jour.</p>
    </section>
  );

  const captured = new Date(a.capturedAt);
  const stale = Date.now() - captured.getTime() > ACTIVITY_STALE_MS;
  const days = fillActivityDays(a.daily, utcDay(captured));
  const totals = activityTotals(days);

  return (
    <div className="space-y-5">
      <p className={`text-xs ${stale ? "text-amber-300" : "text-muted-foreground"}`} role="status">
        {stale ? "Données anciennes : " : "Mis à jour le "}{captured.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile icon={Users} label="Membres classés" value={n(a.rankedMembers)} />
        <Tile icon={Hash} label="Messages · 30 j" value={n(totals.messages)} />
        <Tile icon={UserPlus} label="Arrivées · 30 j" value={n(totals.joins)} />
        <Tile icon={UserMinus} label="Départs · 30 j" value={n(totals.leaves)} />
      </div>
      <MessagesChart days={days} />
      <section className="console-theme-panel space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-semibold"><Crown className="h-4 w-4" /> Classement XP</h3>
        {!a.levelsEnabled && <p className="text-sm text-muted-foreground">Les niveaux sont désactivés sur ce serveur : le classement ne bouge plus.</p>}
        {a.topXp.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="py-2 pr-3">#</th><th className="pr-3">Membre</th><th className="pr-3 text-right">Niveau</th><th className="pr-3 text-right">XP</th><th className="pr-3 text-right">Messages</th><th className="text-right">Vocal</th></tr></thead>
              <tbody className="divide-y divide-border">
                {a.topXp.map((m, i) => (
                  <tr key={m.userId}>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="pr-3">{m.displayName ?? "Membre"}</td>
                    <td className="pr-3 text-right font-mono">{m.level}</td>
                    <td className="pr-3 text-right font-mono">{n(m.xp)}</td>
                    <td className="pr-3 text-right font-mono">{n(m.messages)}</td>
                    <td className="text-right font-mono">{n(Math.round(m.voiceMinutes / 60))} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Personne n’a encore gagné d’XP.</p>}
      </section>
      <section className="console-theme-panel space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4" /> Animations</h3>
        {a.animation ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Comptage en cours</dt><dd className="mt-1 font-mono text-lg">{n(a.animation.countingCurrent)}</dd></div>
            <div><dt className="text-muted-foreground">Record du comptage</dt><dd className="mt-1 font-mono text-lg">{n(a.animation.countingRecord)}</dd></div>
            <div><dt className="text-muted-foreground">Messages en vedette</dt><dd className="mt-1 font-mono text-lg">{n(a.animation.starboardPosts)}</dd></div>
            <div><dt className="text-muted-foreground">Questions du jour</dt><dd className="mt-1 font-mono text-lg">{n(a.animation.qotdPosted)}</dd></div>
          </dl>
        ) : <p className="text-sm text-muted-foreground">Aucune animation configurée sur ce serveur.</p>}
      </section>
    </div>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <div className="console-glass-tile p-4"><p className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</p><p className="mt-2 font-mono text-2xl">{value}</p></div>;
}

/** Daily messages over 30 days: plain bars, each one labelled for screen readers. */
function MessagesChart({ days }: { days: ActivityDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.messages));
  return (
    <section className="console-theme-panel space-y-3 p-4">
      <h3 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4" /> Messages par jour</h3>
      <ol className="flex h-40 items-end gap-[3px]" aria-label="Messages par jour sur 30 jours">
        {days.map((d) => (
          <li key={d.day} className="group relative flex h-full flex-1 items-end" aria-label={`${shortDay(d.day)} : ${n(d.messages)} messages, ${d.joins} arrivées, ${d.leaves} départs`}>
            <span className="block w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(d.messages ? 3 : 0, (d.messages / max) * 100)}%` }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs shadow group-hover:block">{shortDay(d.day)} · {n(d.messages)} messages</span>
          </li>
        ))}
      </ol>
      <div className="flex justify-between text-xs text-muted-foreground"><span>{shortDay(days[0]!.day)}</span><span>{shortDay(days.at(-1)!.day)}</span></div>
    </section>
  );
}
