import { Link } from "@tanstack/react-router";
import { KeyRound, Save, ShieldCheck, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSectionSettings } from "@/components/useSectionSettings";
import { DOG_LEASH_LIMIT, type WakeupSettings } from "@/lib/bot-settings";
import { BOT_PROFILES, BOT_PROFILE_IDS, DEFAULT_PREFIXES } from "@/lib/bot-profiles";

type Chan = { id: string; name: string; type: number };
type Role = { id: string; name: string };

const SECTIONS = ["dog", "wakeup"] as const;
const select = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const box = "console-theme-panel p-4 space-y-4";
const EMPTY_WAKEUP: WakeupSettings = { ownerChannelId: null, waitingChannelId: null, excludedChannelIds: [] };

/**
 * SYS+, WHITELIST and ADMIN+ roles are shown read-only: they are sensitive permissions, changed
 * only by the owner from Discord (/sysp), where each change is audited. The DOG limit and the
 * WAKEUP channels are ordinary settings and can be edited here.
 */
export function AccessPanel({ guildId, channels, roles, onDirtyChange }: { guildId: string; channels: Chan[]; roles: Role[]; onDirtyChange?: (dirty: boolean) => void }) {
  const { q, s, set, dirty, saving, save } = useSectionSettings(guildId, SECTIONS, onDirtyChange);
  const roleName = (id: string | null | undefined) => (id ? roles.find((r) => r.id === id)?.name ?? `Rôle introuvable (${id})` : "Non configuré");
  const voice = channels.filter((c) => c.type === 2);
  const wakeup = s.wakeup ?? EMPTY_WAKEUP;
  const setWakeup = (value: Partial<WakeupSettings>) => set("wakeup", { ...wakeup, ...value });
  const leashes = s.dog?.maxActiveLeashes ?? DOG_LEASH_LIMIT.default;

  if (q.isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (q.error) return <p className="text-destructive">{q.error.message}</p>;

  return (
    <div className="space-y-5">
      <section className={box}>
        <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Rôles de confiance</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">SYS+</dt><dd className="mt-1 font-medium">{roleName(s.sysPlus.roleId)}</dd></div>
          <div><dt className="text-muted-foreground">WHITELIST</dt><dd className="mt-1 font-medium">{roleName(s.sysPlus.whitelistRoleId)}</dd></div>
          <div><dt className="text-muted-foreground">ADMIN+</dt><dd className="mt-1 font-medium">{roleName(s.adminPlus.roleId)}</dd></div>
        </dl>
        <p className="text-sm">PND Intelligence : {s.sysPlus.intelligenceEnabled ? `activée dans #${channels.find((c) => c.id === s.sysPlus.intelligenceChannelId)?.name ?? "salon introuvable"}` : "désactivée"}</p>
        <p className="text-xs text-muted-foreground">Ces rôles donnent des pouvoirs sensibles. Ils se changent uniquement depuis Discord par le propriétaire, avec <code>/sysp role</code>, <code>/sysp whitelist-role</code>, <code>/sysp admin-role</code> et <code>/sysp intelligence-toggle</code>. Chaque changement y est journalisé.</p>
        <Button asChild variant="outline" size="sm"><Link to="/admin">Gérer les accès vocaux (/panel et /pv)</Link></Button>
      </section>

      <section className={box}>
        <h3 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> DOG et WAKEUP</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Laisses actives maximum par SYS+ ({DOG_LEASH_LIMIT.min} à {DOG_LEASH_LIMIT.max})</Label>
            <Input type="number" min={DOG_LEASH_LIMIT.min} max={DOG_LEASH_LIMIT.max} value={leashes} onChange={(e) => set("dog", { maxActiveLeashes: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Salon vocal du propriétaire (WAKEUP)</Label>
            <select className={select} value={wakeup.ownerChannelId ?? ""} onChange={(e) => setWakeup({ ownerChannelId: e.target.value || null })}>
              <option value="">Détection automatique par le nom</option>
              {voice.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Salon d’attente (WAKEUP)</Label>
            <select className={select} value={wakeup.waitingChannelId ?? ""} onChange={(e) => setWakeup({ waitingChannelId: e.target.value || null })}>
              <option value="">Détection automatique par le nom</option>
              {voice.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label>Salons vocaux que WAKEUP ne traverse jamais (20 maximum)</Label>
          <div className="mt-2 grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
            {voice.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wakeup.excludedChannelIds.includes(c.id)} disabled={!wakeup.excludedChannelIds.includes(c.id) && wakeup.excludedChannelIds.length >= 20}
                  onChange={(e) => setWakeup({ excludedChannelIds: e.target.checked ? [...wakeup.excludedChannelIds, c.id] : wakeup.excludedChannelIds.filter((id) => id !== c.id) })} />
                {c.name}
              </label>
            ))}
            {!voice.length && <p className="text-xs text-muted-foreground">Aucun salon vocal sur ce serveur.</p>}
          </div>
        </div>
      </section>

      <section className={box}>
        <h3 className="flex items-center gap-2 font-semibold"><TerminalSquare className="h-4 w-4" /> Préfixes des bots</h3>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {BOT_PROFILE_IDS.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <span>{BOT_PROFILES[id].label}</span>
              <code className="font-mono">{DEFAULT_PREFIXES[id] ?? "slash uniquement"}</code>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Préfixes par défaut. Ils peuvent être changés sur le VPS dans <code>bot/config/bots.json</code> : la page n’y a pas accès.</p>
      </section>

      <div className="console-save-bar flex flex-wrap items-center gap-3">
        <Button onClick={() => save()} disabled={saving || !dirty}><Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer"}</Button>
        <p className="text-xs text-muted-foreground">{dirty ? "Modifications non enregistrées." : "Tout est enregistré."}</p>
      </div>
    </div>
  );
}
