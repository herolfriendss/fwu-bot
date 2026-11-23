import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save, ShieldCheck, Sparkles } from "lucide-react";
import { getBotSettings, saveBotSettings } from "@/lib/bot-settings.functions";
import { DEFAULT_SETTINGS, type BotSettings } from "@/lib/bot-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Chan = { id: string; name: string; type: number; parentId: string | null };
type Role = { id: string; name: string; managed: boolean };

const select = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const box = "console-theme-panel p-4 space-y-4";

function Section({ title, icon: Icon, description, children }: {
  title: string;
  icon: typeof ShieldCheck;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={box}>
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4" /> {title}</h3>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ChannelSelect({ value, onChange, channels, placeholder, types = [0, 5] }: {
  value: string | null;
  onChange: (value: string | null) => void;
  channels: Chan[];
  placeholder: string;
  types?: number[];
}) {
  return (
    <select className={select} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {channels.filter((c) => types.includes(c.type)).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
    </select>
  );
}

function RoleSelect({ value, onChange, roles, placeholder }: {
  value: string | null;
  onChange: (value: string | null) => void;
  roles: Role[];
  placeholder: string;
}) {
  return (
    <select className={select} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {roles.filter((r) => !r.managed).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
}

export function V4ModulesPanel({ guildId, channels, roles }: { guildId: string; channels: Chan[]; roles: Role[] }) {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getBotSettings);
  const save = useServerFn(saveBotSettings);
  const q = useQuery({ queryKey: ["bot-settings", guildId], queryFn: () => fetchSettings({ data: { guildId } }), enabled: !!guildId });
  const [s, setS] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [livePlatform, setLivePlatform] = useState<"youtube" | "tiktok" | "twitch" | "other">("youtube");
  const [liveName, setLiveName] = useState("");
  const [liveFeed, setLiveFeed] = useState("");

  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);

  const set = <K extends keyof BotSettings>(key: K, value: Partial<BotSettings[K]>) => setS((prev) => ({ ...prev, [key]: { ...(prev[key] as object), ...value } }));

  async function onSave() {
    setSaving(true);
    try {
      const saved = await save({ data: { guildId, settings: s } });
      qc.setQueryData(["bot-settings", guildId], saved);
      toast.success("Modules V4 enregistrés : le bot appliquera les réglages d’ici 1 minute.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  if (!guildId) return <p className="text-muted-foreground">Choisis un serveur.</p>;
  if (q.isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (q.error) return <p className="text-destructive">{q.error.message}</p>;

  return (
    <div className="space-y-5">
      <Section title="Journal centralisé" icon={ShieldCheck} description="Tous les événements importants de ce serveur sont envoyés dans un seul salon #logs. Configure-le une seule fois ici.">
        <div>
          <Label>Salon unique des logs</Label>
          <ChannelSelect value={s.logs.channelId} channels={channels} onChange={(v) => set("logs", { channelId: v })} placeholder="Désactiver le journal centralisé" />
          <p className="mt-1 text-xs text-muted-foreground">Le bot doit pouvoir voir le salon, envoyer des messages et intégrer des liens. Chaque serveur possède son propre salon de logs.</p>
        </div>
      </Section>
      <Section title="Identité visuelle & annonces webhook" icon={Sparkles} description="Les panneaux 1942 reprennent l'identité visuelle du serveur. Les publications webhook sont animées par défaut.">
        <div className="overflow-hidden rounded-xl border border-violet-400/25 shadow-[0_12px_32px_-18px_rgba(139,92,246,.55)]">
          <img src="/media/her-v5-city-loop.gif" alt="Ville nocturne aux lumières violettes — identité visuelle 1942" className="block aspect-[3/1] w-full object-cover" loading="lazy" />
        </div>
        <p className="text-sm text-muted-foreground">Les annonces webhook reçoivent cette bannière animée. L'animation est activée à la création de chaque webhook ; tu peux la désactiver ou la réactiver sans supprimer le webhook.</p>
        <div className="rounded-lg border border-violet-400/20 bg-violet-950/20 p-3 text-sm">
          <p className="font-semibold text-violet-200">Commande Discord</p>
          <code className="mt-1 block text-xs text-violet-100">/webhook animation etat:off</code>
          <p className="mt-1 text-xs text-muted-foreground">Coupe l'animation pour tous les webhooks de ce serveur. Ajoute l'option <code>id</code> pour ne modifier qu'un webhook. Utilise <code>etat:on</code> pour la réactiver.</p>
        </div>
      </Section>
      <Section title="Assistant IA 1942" icon={Sparkles} description="Répond lorsqu’un membre mentionne le bot. La mémoire est facultative et isolée par serveur et par membre.">
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.ai.enabled} onCheckedChange={(v) => set("ai", { enabled: v })} /> Activer les réponses IA aux mentions</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.ai.memoryEnabled} onCheckedChange={(v) => set("ai", { memoryEnabled: v })} /> Activer la mémoire des conversations</label>
        <p className="text-xs text-muted-foreground">La mémoire nécessite deux accords : l'activation par l'équipe dans ce panneau, puis le consentement individuel du membre avec <code>/ia memoire etat:Activer</code> ou <code>=ia memoire on</code>. Chaque membre peut retirer son accord avec <code>/ia memoire</code> / <code>=ia memoire off</code>, ou supprimer son historique avec <code>/ia oublier</code>. 1942 conserve au maximum 12 messages de contexte pendant 30 jours. Limite : 5 demandes par membre et par minute.</p>
        <div>
          <Label>Instructions de l’assistant</Label>
          <Textarea rows={4} maxLength={2000} value={s.ai.instructions} onChange={(e) => set("ai", { instructions: e.target.value })} />
        </div>
      </Section>
      <Section title="GuildGuard" icon={ShieldCheck} description="Admission, anti-raid et confinement. Chaque serveur garde ses propres réglages.">
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.guildGuard.enabled} onCheckedChange={(v) => set("guildGuard", { enabled: v })} /> Activer GuildGuard</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Âge minimal du compte (jours)</Label>
            <Input type="number" min={0} max={365} value={s.guildGuard.minAccountAgeDays} onChange={(e) => set("guildGuard", { minAccountAgeDays: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Action pour un compte récent</Label>
            <select className={select} value={s.guildGuard.youngAccountAction} onChange={(e) => set("guildGuard", { youngAccountAction: e.target.value as BotSettings["guildGuard"]["youngAccountAction"] })}>
              <option value="log">Journaliser</option>
              <option value="kick">Expulser</option>
              <option value="quarantine">Rôle de quarantaine</option>
            </select>
          </div>
          <div>
            <Label>Rôle de quarantaine</Label>
            <RoleSelect value={s.guildGuard.quarantineRoleId} roles={roles} onChange={(v) => set("guildGuard", { quarantineRoleId: v })} placeholder="Aucun" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Les événements GuildGuard sont envoyés dans le salon unique configuré dans « Journal centralisé ».</p>
          <div>
            <Label>Connexions autorisées avant alerte</Label>
            <Input type="number" min={0} max={100} value={s.guildGuard.raidJoinThreshold} onChange={(e) => set("guildGuard", { raidJoinThreshold: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Fenêtre anti-raid (secondes)</Label>
            <Input type="number" min={10} max={600} value={s.guildGuard.raidWindowSeconds} onChange={(e) => set("guildGuard", { raidWindowSeconds: Number(e.target.value) })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.guildGuard.lockdown} onCheckedChange={(v) => set("guildGuard", { lockdown: v })} /> Confinement : contrôler toutes les nouvelles arrivées</label>
      </Section>

      <Section title="Modération & vérification" icon={Sparkles} description="Journal centralisé, sanctions et CAPTCHA par défi de calcul avec tentatives limitées.">
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-muted-foreground sm:col-span-2">Les sanctions et vérifications utilisent le même salon #logs que tous les autres modules.</p>
          <div>
            <Label>Expiration des avertissements (jours)</Label>
            <Input type="number" min={0} max={365} value={s.moderation.warnExpiryDays} onChange={(e) => set("moderation", { warnExpiryDays: Number(e.target.value) })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.moderation.dmOnWarn} onCheckedChange={(v) => set("moderation", { dmOnWarn: v })} /> Envoyer un MP lors d’un avertissement</label>
        <div className="border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm"><Switch checked={s.verification.enabled} onCheckedChange={(v) => set("verification", { enabled: v })} /> Activer la vérification</label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Rôle attribué après vérification</Label>
              <RoleSelect value={s.verification.roleId} roles={roles} onChange={(v) => set("verification", { roleId: v })} placeholder="Choisir un rôle" />
            </div>
            <div>
              <Label>Salon du panneau</Label>
              <ChannelSelect value={s.verification.channelId} channels={channels} onChange={(v) => set("verification", { channelId: v })} placeholder="Choisir un salon" />
            </div>
            <div>
              <Label>Âge minimal du compte (jours)</Label>
              <Input type="number" min={0} max={365} value={s.verification.minAccountAgeDays} onChange={(e) => set("verification", { minAccountAgeDays: Number(e.target.value) })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Message du panneau</Label>
              <Textarea rows={2} value={s.verification.message} onChange={(e) => set("verification", { message: e.target.value })} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Tickets staff" icon={Sparkles} description="Salons privés ouverts à la demande. Publie le panneau avec /ticket panel.">
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.tickets.enabled} onCheckedChange={(v) => set("tickets", { enabled: v })} /> Activer les tickets</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Catégorie des tickets</Label>
            <ChannelSelect value={s.tickets.categoryId} channels={channels} onChange={(v) => set("tickets", { categoryId: v })} placeholder="Racine du serveur" types={[4]} />
          </div>
          <div>
            <Label>Rôle support</Label>
            <RoleSelect value={s.tickets.supportRoleId} roles={roles} onChange={(v) => set("tickets", { supportRoleId: v })} placeholder="Staff du serveur" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Ouvertures, prises en charge et fermetures de tickets sont envoyées dans le journal centralisé.</p>
          <div>
            <Label>Tickets ouverts simultanés par membre</Label>
            <Input type="number" min={1} max={5} value={s.tickets.maxOpenPerUser} onChange={(e) => set("tickets", { maxOpenPerUser: Number(e.target.value) })} />
          </div>
        </div>
      </Section>

      <Section title="Vocal V2" icon={Sparkles} description="Hub « rejoindre pour créer » : chaque membre obtient un salon temporaire.">
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.tempVoice.enabled} onCheckedChange={(v) => set("tempVoice", { enabled: v })} /> Activer les salons vocaux temporaires</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Salon hub</Label>
            <ChannelSelect value={s.tempVoice.hubChannelId} channels={channels} onChange={(v) => set("tempVoice", { hubChannelId: v })} placeholder="Choisir un salon vocal" types={[2]} />
          </div>
          <div>
            <Label>Catégorie des salons créés</Label>
            <ChannelSelect value={s.tempVoice.categoryId} channels={channels} onChange={(v) => set("tempVoice", { categoryId: v })} placeholder="Même catégorie que le hub" types={[4]} />
          </div>
          <div>
            <Label>Limite par défaut (0 = illimitée)</Label>
            <Input type="number" min={0} max={99} value={s.tempVoice.defaultLimit} onChange={(e) => set("tempVoice", { defaultLimit: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Modèle de nom</Label>
            <Input value={s.tempVoice.nameTemplate} onChange={(e) => set("tempVoice", { nameTemplate: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="Alertes LIVE — TikTok, YouTube, Twitch…" icon={Sparkles} description="Le bot surveille les flux RSS/Atom HTTPS des créateurs choisis et publie une alerte dans le salon configuré lorsqu’un nouvel élément annonce explicitement un LIVE.">
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.liveAlerts.enabled} onCheckedChange={(v) => set("liveAlerts", { enabled: v })} /> Activer les alertes LIVE</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.liveAlerts.animated} onCheckedChange={(v) => set("liveAlerts", { animated: v })} /> Afficher les bannières LIVE animées FWU</label>
        <div>
          <Label>Salon de diffusion des alertes</Label>
          <ChannelSelect value={s.liveAlerts.channelId} channels={channels} onChange={(v) => set("liveAlerts", { channelId: v })} placeholder="Choisir le salon des annonces" />
        </div>
        <div>
          <Label>Rôle mentionné à chaque LIVE</Label>
          <RoleSelect value={s.liveAlerts.mentionRoleId} roles={roles} onChange={(v) => set("liveAlerts", { mentionRoleId: v })} placeholder="Aucune mention" />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <Label>Plateforme</Label>
            <select className={select} value={livePlatform} onChange={(e) => setLivePlatform(e.target.value as typeof livePlatform)}>
              <option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="twitch">Twitch</option><option value="other">Autre</option>
            </select>
          </div>
          <div>
            <Label>Nom du créateur</Label>
            <Input value={liveName} onChange={(e) => setLiveName(e.target.value)} placeholder="Pseudo du créateur" maxLength={80} />
          </div>
          <div>
            <Label>URL du flux RSS/Atom HTTPS</Label>
            <Input value={liveFeed} onChange={(e) => setLiveFeed(e.target.value)} placeholder="https://…/feed.xml" />
          </div>
        </div>
        <Button type="button" variant="outline" disabled={!liveName.trim() || !liveFeed.trim() || s.liveAlerts.creators.length >= 30} onClick={() => {
          try {
            const url = new URL(liveFeed.trim());
            if (url.protocol !== "https:") throw new Error("HTTPS obligatoire");
            const id = `${livePlatform}-${Date.now()}`;
            set("liveAlerts", { creators: [...s.liveAlerts.creators, { id, platform: livePlatform, displayName: liveName.trim().slice(0, 80), feedUrl: url.toString() }] });
            setLiveName(""); setLiveFeed("");
            toast.success("Créateur ajouté à la surveillance.");
          } catch { toast.error("Entre une URL de flux RSS/Atom HTTPS valide."); }
        }}>Ajouter ce créateur</Button>
        <div className="space-y-2">
          {s.liveAlerts.creators.map((creator) => <div key={creator.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div><strong>{creator.displayName}</strong><p className="text-xs text-muted-foreground">{creator.platform.toUpperCase()} · {creator.feedUrl}</p></div>
            <Button type="button" size="sm" variant="destructive" onClick={() => set("liveAlerts", { creators: s.liveAlerts.creators.filter((c) => c.id !== creator.id) })}>Retirer</Button>
          </div>)}
          {!s.liveAlerts.creators.length && <p className="text-xs text-muted-foreground">Aucun créateur surveillé. Maximum : 30 par serveur.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Vérification toutes les 60 secondes. Pour TikTok et Twitch, ajoute un flux RSS/Atom compatible avec les événements LIVE (par exemple un flux fourni par un service que tu héberges ou auquel tu fais confiance). Les flux vidéo ordinaires ne garantissent pas la détection d’un démarrage de direct. Aucun mot de passe de réseau social n’est demandé.</p>
      </Section>

      <Section title="Automatisation" icon={Sparkles} description="Rôles automatiques et MP de bienvenue. Les messages planifiés se gèrent avec /automation schedule.">
        <div>
          <Label>Rôles attribués automatiquement (maximum 10)</Label>
          <div className="mt-2 grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
            {roles.filter((r) => !r.managed).map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.automation.autoRoleIds.includes(role.id)}
                  onChange={(e) => {
                    const ids = e.target.checked
                      ? [...s.automation.autoRoleIds, role.id]
                      : s.automation.autoRoleIds.filter((id) => id !== role.id);
                    set("automation", { autoRoleIds: ids });
                  }}
                />
                {role.name}
              </label>
            ))}
            {!roles.length && <p className="text-xs text-muted-foreground">Aucun rôle disponible.</p>}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.automation.welcomeDm} onCheckedChange={(v) => set("automation", { welcomeDm: v })} /> Envoyer un MP de bienvenue</label>
        <div>
          <Label>Message du MP ({"{user}"} et {"{server}"})</Label>
          <Textarea rows={2} value={s.automation.welcomeDmMessage} onChange={(e) => set("automation", { welcomeDmMessage: e.target.value })} />
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer les modules V4"}</Button>
        <p className="text-xs text-muted-foreground">Les commandes Discord et le dashboard écrivent la même configuration, sans écraser les autres modules.</p>
      </div>
    </div>
  );
}
