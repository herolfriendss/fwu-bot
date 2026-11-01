import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { getVoiceAdmin, saveVoiceAdmin } from "@/lib/voice-admin.functions";
import { DEFAULT_VOICE_ACCESS, voiceAccessSchema, type VoiceAccess } from "@/lib/voice-access";

export function VoiceAccessPanel({ guildId }: { guildId: string }) {
  const fetchAdmin = useServerFn(getVoiceAdmin);
  const save = useServerFn(saveVoiceAdmin);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["voice-admin", guildId], queryFn: () => fetchAdmin({ data: { guildId } }), retry: false });
  const [access, setAccess] = useState<VoiceAccess>(DEFAULT_VOICE_ACCESS);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (q.data) setAccess(q.data.access); }, [q.data]);
  async function onSave() {
    setSaving(true);
    try {
      const result = await save({ data: { guildId, access: voiceAccessSchema.parse(access) } });
      qc.setQueryData(["voice-admin", guildId], { ...q.data, access: result.access });
      await qc.invalidateQueries({ queryKey: ["bot-settings", guildId] });
      toast.success("Accès vocaux enregistrés.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l’enregistrement."); }
    finally { setSaving(false); }
  }
  if (q.isPending) return <p className="text-muted-foreground">Chargement des rôles…</p>;
  if (q.error) return <div className="space-y-3"><p className="text-destructive">{q.error.message}</p><Button variant="outline" onClick={() => q.refetch()}><RefreshCw className="h-4 w-4" /> Réessayer</Button></div>;
  const roles = q.data.roles;
  const known = new Set(roles.map((r) => r.id));
  const dirty = JSON.stringify(access) !== JSON.stringify(q.data.access);
  return <section className="space-y-6">
    <div className="border-b border-border pb-4"><h2 className="text-lg font-semibold">Accès aux commandes vocales</h2><p className="mt-2 text-sm text-muted-foreground">Les rôles configurés ici contrôlent =panel et =pv. =access reste réservé aux membres ayant « Gérer les salons ». Le verrouillage depuis =panel exige aussi l’accès à =pv.</p></div>
    <p role="status" className="border-l-2 border-border pl-3 text-sm text-muted-foreground">Ces réglages nécessitent un bot compatible sur Oracle. La version précédente ignore les rôles : leur activation peut nécessiter une mise à jour initiale du bot. Ensuite, les changements sont récupérés chaque minute, sans redémarrage.</p>
    <div className="grid gap-6 sm:grid-cols-2">
      {([{ key: "panelRoleIds", name: "=panel" }, { key: "pvRoleIds", name: "=pv" }] as const).map(({ key, name }) => {
        const selected = access[key];
        const missing = (selected ?? []).filter((id) => !known.has(id));
        return <fieldset key={key} className="min-w-0 space-y-4"><legend className="mb-3 font-mono text-lg font-semibold">{name}</legend>
          <label className="flex items-center gap-3 text-sm"><Switch checked={selected !== null} disabled={saving} onCheckedChange={(checked) => setAccess((p) => ({ ...p, [key]: checked ? [] : null }))} /> Restreindre aux rôles choisis</label>
          {selected === null ? <p className="text-sm text-muted-foreground">Accès actuel : permission « Gérer les salons » dans le vocal.</p> : <>
            <p className="text-sm text-muted-foreground">{selected.length === 0 ? "Aucun rôle autorisé : administrateurs et propriétaire uniquement." : `${selected.length} rôle(s) autorisé(s)`}</p>
            <div className="max-h-80 space-y-1 overflow-y-auto border-y border-border py-2">
              {roles.map((role) => <label key={role.id} className="flex min-h-10 items-center gap-3 py-2 text-sm"><Checkbox disabled={saving} checked={selected.includes(role.id)} onCheckedChange={(checked) => setAccess((p) => ({ ...p, [key]: checked === true ? [...(p[key] ?? []), role.id] : (p[key] ?? []).filter((id) => id !== role.id) }))} /><span className="min-w-0 break-words">{role.name}</span></label>)}
              {roles.length === 0 && <p className="text-sm text-muted-foreground">Aucun rôle sur ce serveur.</p>}
              {missing.map((id) => <label key={id} className="flex items-center gap-3 py-2 text-sm text-muted-foreground"><Checkbox checked disabled={saving} onCheckedChange={() => setAccess((p) => ({ ...p, [key]: (p[key] ?? []).filter((value) => value !== id) }))} /><span className="break-all">Rôle supprimé · {id}</span></label>)}
            </div>
          </>}
        </fieldset>;
      })}
    </div>
    <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Button onClick={onSave} disabled={saving || !dirty}><Save className="h-4 w-4" />{saving ? "Enregistrement…" : "Enregistrer"}</Button><Button variant="outline" disabled={saving || !dirty} onClick={() => setAccess(q.data.access)}>Annuler</Button></div>
  </section>;
}
