import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Plus, Save, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getBotSettings, savePrefixCommand, deletePrefixCommand } from "@/lib/bot-settings.functions";
import { prefixCommandFormSchema, type PrefixCommand } from "@/lib/prefix-commands";

export function PrefixCommandManager({ guildId }: { guildId: string }) {
  const get = useServerFn(getBotSettings);
  const save = useServerFn(savePrefixCommand);
  const remove = useServerFn(deletePrefixCommand);
  const qc = useQueryClient();
  const key = ["bot-settings", guildId];
  const q = useQuery({ queryKey: key, queryFn: () => get({ data: { guildId } }), enabled: !!guildId, retry: false });
  const [form, setForm] = useState<PrefixCommand | null>(null);
  const [originalName, setOriginalName] = useState<string>();
  const [deleting, setDeleting] = useState<PrefixCommand | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => ReturnType<typeof save>, message: string) {
    setBusy(true); setError("");
    try { const settings = await action(); qc.setQueryData(key, settings); toast.success(message); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Action impossible."); return false; }
    finally { setBusy(false); }
  }
  if (!guildId) return <p className="text-muted-foreground">Choisis un serveur.</p>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 font-semibold">Commandes = ({q.data?.prefixCommands.length ?? "—"})</h2><Button variant="outline" size="icon" aria-label="Actualiser les commandes =" title="Actualiser" disabled={q.isFetching || busy} onClick={() => q.refetch()}><RefreshCw className="h-4 w-4" /></Button><Button disabled={busy || !q.data} onClick={() => { setOriginalName(undefined); setError(""); setForm({ name: "", response: "", permission: "0" }); }}><Plus className="h-4 w-4" />Créer une commande =</Button></div>
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="font-medium">Commandes vocales intégrées (toujours actives sur le bot Oracle)</p>
      <ul className="mt-1 text-muted-foreground"><li><code>=access @membre</code> — autorise une personne à rejoindre ton vocal</li><li><code>=panel</code> — affiche le panneau de gestion du salon vocal et permet de rétablir l’accès</li><li><code>=pv</code> — verrouille ton salon vocal</li></ul>
      <p className="mt-1 text-xs text-muted-foreground">Elles ne passent pas par Discord « / » : elles ne marchent que si le bot tourne sur Oracle avec la dernière version (voir Statut). Rôles autorisés pour =panel et =pv : page Admin. Sans liste de rôles, « Gérer les salons » est requis; =access demande toujours cette permission.</p>
    </div>
    <p className="text-sm text-muted-foreground">Serveur sélectionné · Bot auto-hébergé requis · Synchronisation toutes les minutes</p>
    <div className="border-b border-border pb-3 text-sm"><p className="font-mono">=access · =panel · =pv</p><p className="text-muted-foreground">Vocal : accès, blocage et mode privé · =access demande Gérer les salons; =panel et =pv utilisent leurs rôles autorisés ou Gérer les salons en mode historique · Administrateurs exemptés</p></div>
    <Input aria-label="Rechercher une commande =" placeholder="Rechercher une commande =" value={search} onChange={(e) => setSearch(e.target.value)} />
    {q.isLoading && <p className="text-muted-foreground">Chargement…</p>}
    {q.error && <p role="alert" className="text-destructive">{q.error.message}</p>}
    <ul className="divide-y divide-border">{q.data?.prefixCommands.filter((c) => c.name.includes(search.toLowerCase().replace(/^=/, ""))).map((c) => <li key={c.name} className="flex items-start gap-2 py-4">
      <div className="min-w-0 flex-1"><span className="break-all font-mono text-sm">={c.name}</span><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{c.response}</p><p className="mt-1 text-xs text-muted-foreground">{c.permission === "32" ? "Gérer le serveur" : c.permission === "8192" ? "Gérer les messages" : "Tout le monde"}</p></div>
      <Button variant="ghost" size="icon" disabled={busy} aria-label={`Modifier =${c.name}`} title={`Modifier =${c.name}`} onClick={() => { setOriginalName(c.name); setError(""); setForm({ ...c }); }}><Pencil className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" className="text-destructive" disabled={busy} aria-label={`Supprimer =${c.name}`} title={`Supprimer =${c.name}`} onClick={() => { setError(""); setDeleting(c); }}><Trash2 className="h-4 w-4" /></Button>
    </li>)}</ul>
    {q.data?.prefixCommands.length === 0 && <p className="text-muted-foreground">Aucune commande = enregistrée.</p>}
    <Dialog open={!!form} onOpenChange={(open) => { if (!open && !busy) setForm(null); }}><DialogContent><DialogHeader><DialogTitle>{originalName ? "Modifier la commande =" : "Créer une commande ="}</DialogTitle></DialogHeader>
      {form && <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const parsed = prefixCommandFormSchema.safeParse(form); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Saisie invalide"); return; } if (await run(() => save({ data: { guildId, originalName, command: parsed.data } }), "Commande = enregistrée : application par le bot d’ici une minute.")) setForm(null); }}>
        <label className="block space-y-1 text-sm"><span>Nom (sans =)</span><Input required maxLength={32} disabled={busy} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="reglement" /></label>
        <label className="block space-y-1 text-sm"><span>Réponse du bot</span><Textarea required rows={5} maxLength={2000} disabled={busy} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} /><span className="text-xs text-muted-foreground">{form.response.length}/2000</span></label>
        <label className="block space-y-1 text-sm"><span>Permission requise</span><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={busy} value={form.permission} onChange={(e) => { const permission = e.target.value; if (permission === "0" || permission === "32" || permission === "8192") setForm({ ...form, permission }); }}><option value="0">Tout le monde</option><option value="32">Gérer le serveur</option><option value="8192">Gérer les messages</option></select></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Annuler</Button><Button type="submit" disabled={busy}><Save className="h-4 w-4" />{busy ? "Enregistrement…" : "Enregistrer"}</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Supprimer ={deleting?.name} ?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">La commande sera retirée du serveur sélectionné à la prochaine synchronisation du bot.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Annuler</Button><Button variant="destructive" disabled={busy} onClick={async () => { if (deleting && await run(() => remove({ data: { guildId, name: deleting.name } }), "Commande = supprimée.")) setDeleting(null); }}>Supprimer</Button></div></DialogContent></Dialog>
  </section>;
}
