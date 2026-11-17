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
const box = "rounded-lg border border-border p-4 space-y-4";

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
      {roles.filter((r) => !r.managed && r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
          <div>
            <Label>Salon du journal</Label>
            <ChannelSelect value={s.guildGuard.logChannelId} channels={channels} onChange={(v) => set("guildGuard", { logChannelId: v })} placeholder="Aucun journal" />
          </div>
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

      <Section title="Modération & vérification" icon={Sparkles} description="Journal des sanctions, avertissements et bouton de vérification.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Journal de modération</Label>
            <ChannelSelect value={s.moderation.logChannelId} channels={channels} onChange={(v) => set("moderation", { logChannelId: v })} placeholder="Aucun journal" />
          </div>
          <div>
            <Label>Expiration des avertissements (jours)</Label>
            <Input type="number" min={0} max={365} value={s.moderation.warnExpiryDays} onChange={(e) => set("moderation", { warnExpiryDays: Number(e.target.value) })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.moderation.dmOnWarn} onCheckedChange={(v) => set("moderation", { dmOnWarn: v })} /> Envoyer un MP lors d’un avertissement</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Rôle personnel Protect (intouchable)</Label>
            <RoleSelect value={s.moderation.protectRoleId} roles={roles.filter((role) => role.id !== guildId)} onChange={(v) => set("moderation", { protectRoleId: v })} placeholder="Choisir le rôle Protect" />
          </div>
          <div>
            <Label>Rôles autorisés à sanctionner</Label>
            <p className="text-xs text-muted-foreground">Seuls ces rôles, SYS+ et le propriétaire pourront utiliser warn, mute, unmute, kick et ban.</p>
            <div className="mt-2 grid max-h-40 gap-2 overflow-auto">
              {roles.filter((r) => !r.managed && r.id !== guildId).map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.moderation.staffRoleIds.includes(role.id)} onChange={(e) => {
                    const ids = e.target.checked ? [...s.moderation.staffRoleIds, role.id] : s.moderation.staffRoleIds.filter((id) => id !== role.id);
                    set("moderation", { staffRoleIds: ids });
                  }} />
                  {role.name}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>Autres rôles intouchables (OW, direction, etc.)</Label>
            <p className="text-xs text-muted-foreground">Leurs membres ne pourront pas être sanctionnés et déclencheront la même protection.</p>
            <div className="mt-2 grid max-h-40 gap-2 overflow-auto sm:grid-cols-2">
              {roles.filter((r) => !r.managed && r.id !== guildId).map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.moderation.untouchableRoleIds.includes(role.id)} onChange={(e) => {
                    const ids = e.target.checked ? [...s.moderation.untouchableRoleIds, role.id] : s.moderation.untouchableRoleIds.filter((id) => id !== role.id);
                    set("moderation", { untouchableRoleIds: ids });
                  }} />
                  {role.name}
                </label>
              ))}
            </div>
          </div>
        </div>
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
          <div>
            <Label>Journal des tickets</Label>
            <ChannelSelect value={s.tickets.logChannelId} channels={channels} onChange={(v) => set("tickets", { logChannelId: v })} placeholder="Aucun journal" />
          </div>
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

      <Section title="Automatisation" icon={Sparkles} description="Rôles automatiques et MP de bienvenue. Les messages planifiés se gèrent avec /automation schedule.">
        <div>
          <Label>Rôles attribués automatiquement (maximum 10)</Label>
          <div className="mt-2 grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
            {roles.filter((r) => !r.managed && r.id !== guildId).map((role) => (
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
