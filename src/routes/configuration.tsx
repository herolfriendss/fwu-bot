import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Bot, Hash, Megaphone, Shield, Users, Trash2, Plus, Volume2, Folder, Save, BarChart3, Command, UserRoundCheck, Server, SlidersHorizontal, KeyRound, Activity } from "lucide-react";
import { getOverview } from "@/lib/discord.functions";
import { cn } from "@/lib/utils";
import {
  updateProfile, updateNickname, getGuildAdmin, createChannel, editChannel, deleteChannel, createRole, deleteRole,
  setMemberRole, moderateMember, getBans, purgeMessages, getAuditLog, sendAnnouncement,
} from "@/lib/discord-admin.functions";
import { IncidentAdvisor } from "@/components/IncidentAdvisor";
import { AccessPanel } from "@/components/AccessPanel";
import { ActivityPanel } from "@/components/ActivityPanel";
import { useConfirm } from "@/components/useConfirm";
import { ServerAnalytics } from "@/components/ServerAnalytics";
import { CommandManager } from "@/components/CommandManager";
import { MembershipRequests } from "@/components/MembershipRequests";
import { BotSettingsPanel } from "@/components/BotSettingsPanel";
import { V4ModulesPanel } from "@/components/V4ModulesPanel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const overviewQuery = queryOptions({ queryKey: ["discord", "overview"], queryFn: () => getOverview(), staleTime: 60_000 });

export const Route = createFileRoute("/configuration")({
  head: () => ({
    meta: [
      { title: "Configuration — FWU V2" },
      { name: "description", content: "Analyses du serveur, profil, salons, rôles, membres, modération et annonces de vos bots Discord FWU." },
      { property: "og:title", content: "Configuration — FWU V2" },
      { property: "og:description", content: "Configuration et statistiques des serveurs de votre bot Discord." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  component: Config,
});

const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btn = "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
const ghost = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";
const danger = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10";
const card = "console-section";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erreur");

const TABS = [
  { id: "profil", label: "Profil", icon: Bot },
  { id: "analyses", label: "Analyses", icon: BarChart3 },
  { id: "activite", label: "Activité et XP", icon: Activity },
  { id: "salons", label: "Salons", icon: Hash },
  { id: "membres", label: "Rôles & membres", icon: Users },
  { id: "moderation", label: "Modération", icon: Shield },
  { id: "annonces", label: "Annonces", icon: Megaphone },
  { id: "bot", label: "Réponses et filtres", icon: Server },
  { id: "modules", label: "Modules", icon: SlidersHorizontal },
  { id: "acces", label: "Rôles et accès", icon: KeyRound },
  { id: "commandes", label: "Commandes", icon: Command },
  { id: "adhesions", label: "Adhésions", icon: UserRoundCheck },
] as const;
type Tab = (typeof TABS)[number]["id"];

function useAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (fn: () => Promise<unknown>, ok: string) => {
      setBusy(true);
      try {
        await fn();
        toast.success(ok);
        await qc.invalidateQueries({ queryKey: ["discord"] });
        return true;
      } catch (e) {
        toast.error(errMsg(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

function Config() {
  const { data } = useSuspenseQuery(overviewQuery);
  const [tab, setTabNow] = useState<Tab>("profil");
  const [guildId, setGuildIdNow] = useState(data.guilds[0]?.id ?? "");
  // Unsaved edits in the settings tabs: ask before switching tab, server or page.
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guarded = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
  const setTab = (next: Tab) => { if (next !== tab) guarded(() => { setDirty(false); setTabNow(next); }); };
  const setGuildId = (next: string) => { if (next !== guildId) guarded(() => { setDirty(false); setGuildIdNow(next); }); };
  const blocker = useBlocker({ shouldBlockFn: () => dirty, enableBeforeUnload: () => dirty, withResolver: true });
  const fetchAdmin = useServerFn(getGuildAdmin);
  const admin = useQuery({
    queryKey: ["discord", "admin", guildId],
    queryFn: () => fetchAdmin({ data: { guildId } }),
    enabled: !!guildId && tab !== "analyses" && tab !== "activite" && tab !== "commandes" && tab !== "adhesions",
  });

  return (
    <div className="console-shell bg-background">
      <header className="console-header border-b border-border px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-[1376px] flex-wrap items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-sidebar-surface">
            {data.bot.avatar ? <img src={`https://cdn.discordapp.com/avatars/${data.bot.id}/${data.bot.avatar}.png?size=96`} alt="" className="h-full w-full object-cover" /> : <Bot className="h-6 w-6 text-primary" />}
          </div>
          <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold">{data.bot.username}</h1><p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-signal" /> Panneau de contrôle</p></div>
          <select aria-label="Serveur" value={guildId} onChange={(e) => setGuildId(e.target.value)} className={cn(input, "max-w-full sm:max-w-60 w-auto")}>
            {data.guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </header>
      <SiteNav />
      <div className="console-layout">
        <nav aria-label="Configuration du bot" className="console-nav">
          <p className="mb-4 hidden px-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground md:block">Configuration</p>
          <div className="console-nav-items space-y-1 max-md:space-y-0">
          {TABS.map((t) => (
            <Button key={t.id} onClick={() => setTab(t.id)} variant="ghost" aria-pressed={tab === t.id}
              className="console-nav-item px-3 text-left text-sm">
              <t.icon className="h-4 w-4" /> {t.label}
            </Button>
          ))}
          </div>
          <div className="mt-10 hidden border-t border-border px-3 pt-5 md:block"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Shield className="h-3.5 w-3.5 text-primary" /> Accès propriétaire</p></div>
        </nav>
        <main className="console-main min-w-0">
          <div className="mb-8 flex items-center justify-between gap-4 border-b border-border pb-6"><div><p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Configuration / {TABS.find((t) => t.id === tab)?.label}</p><h2 className="text-2xl font-semibold">{TABS.find((t) => t.id === tab)?.label}</h2></div><span className="hidden font-mono text-xs text-muted-foreground sm:block">{String(TABS.findIndex((t) => t.id === tab) + 1).padStart(2, "0")} / {String(TABS.length).padStart(2, "0")}</span></div>
          <div key={`${tab}-${guildId}`} className="console-content space-y-4">
          {tab === "profil" && <Profile name={data.bot.username} guildId={guildId} />}
          {tab !== "profil" && !guildId && <p className="text-muted-foreground">Le bot n'est sur aucun serveur.</p>}
          {tab === "analyses" && guildId && <ServerAnalytics key={guildId} guildId={guildId} />}
          {tab === "activite" && guildId && <ActivityPanel key={guildId} guildId={guildId} />}
          {tab !== "profil" && tab !== "analyses" && tab !== "activite" && tab !== "commandes" && tab !== "adhesions" && guildId && admin.isLoading && <p className="text-muted-foreground">Chargement…</p>}
          {tab !== "profil" && tab !== "analyses" && tab !== "activite" && tab !== "commandes" && tab !== "adhesions" && admin.error && <p className="text-destructive">{errMsg(admin.error)}</p>}
          {admin.data && tab === "salons" && <Channels guildId={guildId} channels={admin.data.channels} />}
          {admin.data && tab === "membres" && <Members guildId={guildId} admin={admin.data} />}
          {admin.data && tab === "moderation" && <Moderation guildId={guildId} admin={admin.data} />}
          {admin.data && tab === "annonces" && <Announce channels={admin.data.channels} />}
          {admin.data && tab === "bot" && <BotSettingsPanel key={guildId} guildId={guildId} channels={admin.data.channels.filter((c) => c.type === 0 || c.type === 5)} onDirtyChange={onDirtyChange} />}
          {admin.data && tab === "acces" && <AccessPanel key={guildId} guildId={guildId} channels={admin.data.channels} roles={admin.data.roles} onDirtyChange={onDirtyChange} />}
          {admin.data && tab === "modules" && <V4ModulesPanel key={guildId} guildId={guildId} channels={admin.data.channels} roles={admin.data.roles} onDirtyChange={onDirtyChange} />}
          {tab === "commandes" && <CommandManager guildId={guildId} />}
          {tab === "adhesions" && guildId && <MembershipRequests guildId={guildId} />}
          </div>
        </main>
      </div>
      <AlertDialog open={pending !== null || blocker.status === "blocked"} onOpenChange={(open) => { if (!open) { setPending(null); blocker.reset?.(); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Modifications non enregistrées</AlertDialogTitle>
            <AlertDialogDescription>Si tu quittes maintenant, les changements faits sur cette page seront perdus.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Rester sur la page</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const next = pending; setPending(null); setDirty(false); if (next) next(); else blocker.proceed?.(); }}>Quitter sans enregistrer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type Admin = Awaited<ReturnType<typeof getGuildAdmin>>;

function Profile({ name, guildId }: { name: string; guildId: string }) {
  const save = useServerFn(updateProfile);
  const nickFn = useServerFn(updateNickname);
  const { busy, run } = useAction();
  const [username, setUsername] = useState(name);
  const [nick, setNick] = useState("");

  function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => run(() => save({ data: { avatar: String(r.result) } }), "Avatar mis à jour");
    r.readAsDataURL(f);
  }

  return (
    <>
      <section className={card}>
        <h2 className="mb-4 font-semibold">Profil du bot</h2>
        <label className="text-sm text-muted-foreground">Nom d'utilisateur</label>
        <div className="mt-1 flex gap-2">
          <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} />
          <button className={btn} disabled={busy} onClick={() => run(() => save({ data: { username } }), "Nom mis à jour")}><Save className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Discord limite le changement de nom à 2 fois par heure.</p>
        <label className="mt-4 block text-sm text-muted-foreground">Avatar</label>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onAvatar} disabled={busy} className="mt-1 text-sm" />
      </section>
      {guildId && (
        <section className={card}>
          <h2 className="mb-4 font-semibold">Surnom sur ce serveur</h2>
          <div className="flex gap-2">
            <input className={input} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder="Vide = nom par défaut" />
            <button className={btn} disabled={busy} onClick={() => run(() => nickFn({ data: { guildId, nick } }), "Surnom mis à jour")}><Save className="h-4 w-4" /></button>
          </div>
        </section>
      )}
    </>
  );
}

const typeIcon = (t: number) => (t === 2 ? Volume2 : t === 4 ? Folder : Hash);

function Channels({ guildId, channels }: { guildId: string; channels: Admin["channels"] }) {
  const create = useServerFn(createChannel);
  const edit = useServerFn(editChannel);
  const del = useServerFn(deleteChannel);
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [type, setType] = useState(0);
  const [parentId, setParentId] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; topic: string } | null>(null);
  const cats = channels.filter((c) => c.type === 4);
  const { ask, dialog } = useConfirm();

  return (
    <>
      <section className={card}>
        <h2 className="mb-4 font-semibold">Créer un salon</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input className={input} placeholder="nom-du-salon" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={input} value={type} onChange={(e) => setType(Number(e.target.value))}>
            <option value={0}>Texte</option><option value={2}>Vocal</option><option value={4}>Catégorie</option>
          </select>
          <select className={input} value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={type === 4}>
            <option value="">Sans catégorie</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className={btn} disabled={busy || !name.trim()} onClick={async () => {
            if (await run(() => create({ data: { guildId, name, type, parentId: parentId || null } }), "Salon créé")) setName("");
          }}><Plus className="h-4 w-4" /> Créer</button>
        </div>
      </section>
      <section className={card}>
        <h2 className="mb-3 font-semibold">Salons ({channels.length})</h2>
        <ul className="divide-y divide-border">
          {channels.map((c) => {
            const I = typeIcon(c.type);
            if (editing?.id === c.id) return (
              <li key={c.id} className="space-y-2 py-3">
                <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                {c.type !== 4 && <input className={input} placeholder="Sujet du salon" value={editing.topic} onChange={(e) => setEditing({ ...editing, topic: e.target.value })} />}
                <div className="flex gap-2">
                  <button className={btn} disabled={busy} onClick={async () => { if (await run(() => edit({ data: { channelId: c.id, name: editing.name, topic: editing.topic } }), "Salon modifié")) setEditing(null); }}>Enregistrer</button>
                  <button className={ghost} onClick={() => setEditing(null)}>Annuler</button>
                </div>
              </li>
            );
            return (
              <li key={c.id} className={`flex items-center gap-2 py-2 text-sm ${c.parentId ? "pl-5" : ""}`}>
                <I className="h-4 w-4 text-muted-foreground" />
                <span className={`flex-1 truncate ${c.type === 4 ? "text-xs font-semibold uppercase tracking-wider" : ""}`}>{c.name}</span>
                <button className={ghost} onClick={() => setEditing({ id: c.id, name: c.name, topic: c.topic })}>Modifier</button>
                <button className={danger} disabled={busy} aria-label={`Supprimer ${c.name}`} onClick={async () => { if (await ask({ title: `Supprimer « ${c.name} » ?`, description: "Le salon et tous ses messages seront supprimés définitivement.", confirm: "Supprimer", danger: true })) await run(() => del({ data: { channelId: c.id } }), "Salon supprimé"); }}><Trash2 className="h-3 w-3" /></button>
              </li>
            );
          })}
        </ul>
      </section>
      {dialog}
    </>
  );
}

const hex = (n: number) => (n ? `#${n.toString(16).padStart(6, "0")}` : undefined);

function Members({ guildId, admin }: { guildId: string; admin: Admin }) {
  const mkRole = useServerFn(createRole);
  const rmRole = useServerFn(deleteRole);
  const setRole = useServerFn(setMemberRole);
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5865f2");
  const [q, setQ] = useState("");
  const roleById = new Map(admin.roles.map((r) => [r.id, r]));
  const assignable = admin.roles.filter((r) => !r.managed);
  const members = admin.members.filter((m) => (m.name + m.username).toLowerCase().includes(q.toLowerCase()));
  const { ask, dialog } = useConfirm();

  return (
    <>
      <section className={card}>
        <h2 className="mb-4 font-semibold">Rôles ({admin.roles.length})</h2>
        <div className="mb-4 flex gap-2">
          <input className={input} placeholder="Nom du rôle" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 rounded border border-input bg-background" />
          <button className={btn} disabled={busy || !name.trim()} onClick={async () => { if (await run(() => mkRole({ data: { guildId, name, color } }), "Rôle créé")) setName(""); }}><Plus className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {admin.roles.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" style={hex(r.color) ? { background: hex(r.color) } : undefined} />
              {r.name}
              {!r.managed && <button aria-label="Supprimer" className="text-muted-foreground hover:text-destructive" onClick={async () => { if (await ask({ title: `Supprimer le rôle « ${r.name} » ?`, description: "Les membres qui l’ont le perdront. Cette action est définitive.", confirm: "Supprimer", danger: true })) await run(() => rmRole({ data: { guildId, roleId: r.id } }), "Rôle supprimé"); }}><Trash2 className="h-3 w-3" /></button>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Le bot ne peut gérer que les rôles placés sous son propre rôle.</p>
      </section>
      <section className={card}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 font-semibold">Membres ({admin.members.length})</h2>
          <input className={cn(input, "max-w-48")} placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {admin.membersError && <p className="text-sm text-muted-foreground">{admin.membersError}</p>}
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-32 flex-1 truncate font-medium">{m.name} {m.bot && <span className="ml-1 rounded bg-accent px-1 text-[10px] text-accent-foreground">BOT</span>}</span>
              {m.roles.map((rid) => roleById.get(rid)).filter(Boolean).map((r) => (
                <button key={r!.id} disabled={busy || r!.managed} title="Retirer" className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-destructive"
                  onClick={() => run(() => setRole({ data: { guildId, userId: m.id, roleId: r!.id, add: false } }), "Rôle retiré")}>{r!.name} ×</button>
              ))}
              <select className="rounded-md border border-input bg-background px-2 py-1 text-xs" value="" disabled={busy}
                onChange={(e) => e.target.value && run(() => setRole({ data: { guildId, userId: m.id, roleId: e.target.value, add: true } }), "Rôle ajouté")}>
                <option value="">+ rôle</option>
                {assignable.filter((r) => !m.roles.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </li>
          ))}
        </ul>
      </section>
      {dialog}
    </>
  );
}

function Moderation({ guildId, admin }: { guildId: string; admin: Admin }) {
  const mod = useServerFn(moderateMember);
  const purge = useServerFn(purgeMessages);
  const fetchBans = useServerFn(getBans);
  const fetchLog = useServerFn(getAuditLog);
  const { busy, run } = useAction();
  const bans = useQuery({ queryKey: ["discord", "bans", guildId], queryFn: () => fetchBans({ data: { guildId } }), retry: false });
  const log = useQuery({ queryKey: ["discord", "audit", guildId], queryFn: () => fetchLog({ data: { guildId } }), retry: false });
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [chan, setChan] = useState("");
  const [count, setCount] = useState(10);
  const texts = admin.channels.filter((c) => c.type === 0 || c.type === 5);
  const { ask, dialog } = useConfirm();
  const act = async (action: string, label: string) => {
    if (!userId) { toast.error("Choisis un membre"); return; }
    const who = admin.members.find((m) => m.id === userId)?.name ?? "ce membre";
    if ((action === "ban" || action === "kick") && !(await ask({
      title: action === "ban" ? `Bannir ${who} ?` : `Expulser ${who} ?`,
      description: action === "ban" ? "La personne ne pourra plus revenir tant qu’elle n’est pas débannie." : "La personne pourra revenir avec une nouvelle invitation.",
      confirm: action === "ban" ? "Bannir" : "Expulser", danger: true,
    }))) return;
    await run(() => mod({ data: { guildId, userId, action, minutes, reason } }), label);
  };

  return (
    <>
      <IncidentAdvisor guildId={guildId} />
      <section className={card}>
        <h2 className="mb-4 font-semibold">Sanctionner un membre</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={input} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choisir un membre…</option>
            {admin.members.filter((m) => !m.bot).map((m) => <option key={m.id} value={m.id}>{m.name}{m.timedOutUntil && new Date(m.timedOutUntil) > new Date() ? " (exclu temporairement)" : ""}</option>)}
          </select>
          <input className={input} placeholder="Raison (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="number" min={1} max={40320} className={cn(input, "w-24")} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          <span className="text-sm text-muted-foreground">min</span>
          <button className={btn} disabled={busy} onClick={() => act("timeout", "Membre rendu muet")}>Rendre muet</button>
          <button className="rounded-lg border border-border px-4 py-2 text-sm" disabled={busy} onClick={() => act("untimeout", "Sourdine levée")}>Lever</button>
          <button className="rounded-lg border border-destructive px-4 py-2 text-sm text-destructive" disabled={busy} onClick={() => act("kick", "Membre expulsé")}>Expulser</button>
          <button className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground" disabled={busy} onClick={() => act("ban", "Membre banni")}>Bannir</button>
        </div>
      </section>
      <section className={card}>
        <h2 className="mb-4 font-semibold">Nettoyer un salon</h2>
        <div className="flex flex-wrap gap-2">
          <select className={cn(input, "w-auto flex-1")} value={chan} onChange={(e) => setChan(e.target.value)}>
            <option value="">Choisir un salon…</option>
            {texts.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
          <input type="number" min={2} max={100} className={cn(input, "w-24")} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          <button className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground" disabled={busy || !chan}
            onClick={async () => { if (await ask({ title: `Supprimer les ${count} derniers messages ?`, description: "Les messages supprimés ne peuvent pas être récupérés.", confirm: "Supprimer", danger: true })) await run(async () => {
              const r = await purge({ data: { channelId: chan, count } });
              if (r.skipped) toast.info(`${r.skipped} message(s) de plus de 14 jours ignoré(s)`);
            }, "Messages supprimés"); }}>Supprimer</button>
        </div>
      </section>
      <section className={card}>
        <h2 className="mb-3 font-semibold">Bannis ({bans.data?.length ?? 0})</h2>
        {bans.error && <p className="text-sm text-destructive">Le bot a besoin de la permission « Bannir des membres » pour afficher cette liste.</p>}
        {bans.data?.length === 0 && <p className="text-sm text-muted-foreground">Aucun bannissement.</p>}
        <ul className="divide-y divide-border">
          {bans.data?.map((b) => (
            <li key={b.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{b.username} <span className="text-muted-foreground">{b.reason}</span></span>
              <button className={ghost} disabled={busy} onClick={() => run(() => mod({ data: { guildId, userId: b.id, action: "unban" } }), "Bannissement levé")}>Débannir</button>
            </li>
          ))}
        </ul>
      </section>
      <section className={card}>
        <h2 className="mb-3 font-semibold">Journal des actions</h2>
        {log.error && <p className="text-sm text-destructive">Le bot a besoin de la permission « Voir les logs du serveur ».</p>}
        <ul className="divide-y divide-border">
          {log.data?.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{new Date(e.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
              <span className="font-medium">{e.action}</span>
              <span className="text-muted-foreground">par {e.by}{e.target && ` → ${e.target}`}{e.reason && ` · ${e.reason}`}</span>
            </li>
          ))}
        </ul>
      </section>
      {dialog}
    </>
  );
}

function Announce({ channels }: { channels: Admin["channels"] }) {
  const send = useServerFn(sendAnnouncement);
  const { busy, run } = useAction();
  const texts = channels.filter((c) => c.type === 0 || c.type === 5);
  const empty = { content: "", title: "", description: "", color: "#5865f2", footer: "", imageUrl: "" };
  const [f, setF] = useState(empty);
  const [chan, setChan] = useState("");
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${card} space-y-3`}>
        <h2 className="font-semibold">Nouvelle annonce</h2>
        <select className={input} value={chan} onChange={(e) => setChan(e.target.value)}>
          <option value="">Choisir un salon…</option>
          {texts.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <textarea className={input} rows={2} placeholder="Texte au-dessus (ex : @everyone)" value={f.content} onChange={set("content")} />
        <input className={input} placeholder="Titre" value={f.title} onChange={set("title")} />
        <textarea className={input} rows={5} placeholder="Description" value={f.description} onChange={set("description")} />
        <div className="flex gap-2">
          <input type="color" value={f.color} onChange={set("color")} className="h-10 w-12 rounded border border-input bg-background" />
          <input className={input} placeholder="Pied de page" value={f.footer} onChange={set("footer")} />
        </div>
        <input className={input} placeholder="Lien d'image https://…" value={f.imageUrl} onChange={set("imageUrl")} />
        <button className={`${btn} w-full`} disabled={busy || !chan} onClick={async () => {
          if (await run(() => send({ data: { channelId: chan, ...f } }), "Annonce publiée")) setF(empty);
        }}><Megaphone className="h-4 w-4" /> Publier</button>
      </section>
      <section className={card}>
        <h2 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Aperçu</h2>
        {f.content && <p className="mb-2 whitespace-pre-wrap text-sm">{f.content}</p>}
        {(f.title || f.description || f.imageUrl) && (
          <div className="rounded-md border-l-4 bg-muted p-3" style={{ borderLeftColor: f.color }}>
            {f.title && <p className="font-semibold">{f.title}</p>}
            {f.description && <p className="mt-1 whitespace-pre-wrap text-sm">{f.description}</p>}
            {/^https:\/\//.test(f.imageUrl) && <img src={f.imageUrl} alt="" className="mt-2 max-h-48 rounded" />}
            {f.footer && <p className="mt-2 text-xs text-muted-foreground">{f.footer}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

