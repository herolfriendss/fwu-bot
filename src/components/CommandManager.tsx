import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSlashStatus, registerSlashCommands, saveSlashCommand, deleteSlashCommand } from "@/lib/interactions.functions";
import { commandFormSchema, type CommandForm } from "@/lib/custom-commands";
import { PrefixCommandManager } from "@/components/PrefixCommandManager";

const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const blank: CommandForm = { name: "", description: "", response: "", ephemeral: false, permission: "0" };
const previewEndpoint = "https://project--cbf2f2b2-3ced-4562-8477-65af241b38d3-dev.lovable.app/api/public/discord-interactions";
type Registered = Awaited<ReturnType<typeof getSlashStatus>>["registered"][number];

export function CommandManager({ guildId }: { guildId: string }) {
  const fetchStatus = useServerFn(getSlashStatus);
  const save = useServerFn(saveSlashCommand);
  const remove = useServerFn(deleteSlashCommand);
  const restore = useServerFn(registerSlashCommands);
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["slash"], queryFn: () => fetchStatus(), retry: false });
  const [form, setForm] = useState<CommandForm | null>(null);
  const [builtIn, setBuiltIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Registered | null>(null);
  const [search, setSearch] = useState("");
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await fn(); await qc.invalidateQueries({ queryKey: ["slash"] }); toast.success(message); return true; }
    catch (e) { const message = e instanceof Error ? e.message : "Action impossible"; setError(message); toast.error(message); return false; }
    finally { setBusy(false); }
  };
  const edit = (c: Registered) => {
    setBuiltIn(c.ours); setError("");
    setForm({ id: c.id, name: c.name, description: c.description, response: c.response || (c.ours ? "Comportement intégré" : ""), ephemeral: c.ephemeral,
      permission: c.permission === "32" || c.permission === "8192" ? c.permission : "0" });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(previewEndpoint); toast.success("Adresse copiée"); }
    catch { toast.error("Copie indisponible"); }
  };
  return <>
    <div className="border-b border-border pb-6"><PrefixCommandManager key={guildId} guildId={guildId} /></div>
    <section className="space-y-3 border-b border-border pb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Liaison Discord {status.data?.botName && `· ${status.data.botName}`}</h2>
        <Button variant="outline" size="sm" disabled={status.isFetching || busy} onClick={() => status.refetch()}><RefreshCw className="h-4 w-4" /> Actualiser</Button>
      </div>
      {status.data && <p className={status.data.endpoint ? "text-sm text-primary" : "text-sm text-destructive"}>
        {status.data.endpoint ? "Commandes reliées à Discord" : "Commandes non reliées à ce site"}
      </p>}
      <div className="flex gap-2"><input aria-label="Adresse des interactions" className={`${field} min-w-0 font-mono text-xs`} readOnly value={status.data?.endpoint || previewEndpoint} onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" size="icon" title="Copier l’adresse" aria-label="Copier l’adresse" onClick={copy}><Copy className="h-4 w-4" /></Button></div>
      <div className="flex flex-wrap gap-2">
        {status.data && <Button variant="outline" asChild><a target="_blank" rel="noreferrer" href={`https://discord.com/oauth2/authorize?client_id=${status.data.appId}&scope=bot%20applications.commands&permissions=0${guildId ? `&guild_id=${guildId}` : ""}`}><ExternalLink className="h-4 w-4" /> Ajouter au serveur</a></Button>}
        <Button variant="ghost" asChild><a target="_blank" rel="noreferrer" href={status.data ? `https://discord.com/developers/applications/${status.data.appId}/information` : "https://discord.com/developers/applications"}><ExternalLink className="h-4 w-4" /> Portail Discord</a></Button>
      </div>
      {status.data?.requiresCodeGrant && <p className="text-sm text-muted-foreground">L’invitation simple nécessite de désactiver « Requires OAuth2 Code Grant » dans les réglages Bot de Discord.</p>}
      {status.data?.endpoint && <p className="text-xs text-muted-foreground">Discord utilise actuellement cette version d’aperçu ; après publication, l’adresse devra pointer vers le site publié.</p>}
    </section>
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 font-semibold">Commandes / ({status.data?.registered.length ?? "—"})</h2><Button onClick={() => { setForm({ ...blank }); setBuiltIn(false); setError(""); }} disabled={busy}><Plus className="h-4 w-4" /> Créer une commande /</Button></div>
      <input aria-label="Rechercher une commande" className={field} placeholder="Rechercher une commande" value={search} onChange={(e) => setSearch(e.target.value)} />
      {status.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {status.error && <p role="alert" className="text-sm text-destructive">{status.error.message}</p>}
      {status.data?.missing.length ? <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">Commandes intégrées manquantes : {status.data.missing.map((n) => `/${n}`).join(", ")}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => restore(), "Commandes intégrées restaurées")}>Restaurer les commandes intégrées</Button></div> : null}
      <ul className="divide-y divide-border">{status.data?.registered.filter((c) => c.name.includes(search.toLowerCase())).map((c) => <li key={c.id} className="flex items-start gap-2 py-4">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-sm">/{c.name}</span><span className="text-xs text-muted-foreground">{c.ours ? "Intégrée" : c.custom ? "Personnalisée" : "Externe"}</span></div><p className="mt-1 break-words text-sm text-muted-foreground">{c.description}</p>{c.custom && <p className="mt-2 line-clamp-2 break-words text-sm">{c.response}</p>}</div>
        <Button variant="ghost" size="icon" aria-label={`Modifier /${c.name}`} title={`Modifier /${c.name}`} disabled={busy || c.type !== 1} onClick={() => edit(c)}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="text-destructive" aria-label={`Supprimer /${c.name}`} title={`Supprimer /${c.name}`} disabled={busy} onClick={() => { setDeleting(c); setError(""); }}><Trash2 className="h-4 w-4" /></Button>
      </li>)}</ul>
      {status.data?.registered.length === 0 && <p className="text-muted-foreground">Aucune commande enregistrée.</p>}
    </section>
    <Dialog open={!!form} onOpenChange={(open) => { if (!open && !busy) setForm(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{form?.id ? "Modifier la commande" : "Créer une commande"}</DialogTitle></DialogHeader>
      {form && <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const parsed = commandFormSchema.safeParse(form); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Saisie invalide"); return; } if (await run(() => save({ data: parsed.data }), "Commande enregistrée dans Discord")) setForm(null); }}>
        <label className="block space-y-1 text-sm"><span>Nom de la commande</span><input className={field} value={form.name} disabled={builtIn || busy} maxLength={32} required onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="reglement" /></label>
        <label className="block space-y-1 text-sm"><span>Description</span><input className={field} value={form.description} disabled={busy} maxLength={100} required onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        {!builtIn && <label className="block space-y-1 text-sm"><span>Réponse du bot</span><textarea className={field} rows={5} value={form.response} disabled={busy} maxLength={2000} required onChange={(e) => setForm({ ...form, response: e.target.value })} /><span className="text-xs text-muted-foreground">{form.response.length}/2000</span></label>}
        {builtIn && <p className="text-sm text-muted-foreground">Cette commande conserve son comportement intégré.</p>}
        <label className="block space-y-1 text-sm"><span>Permission requise</span><select className={field} disabled={busy} value={form.permission} onChange={(e) => { const value = e.target.value; if (value === "0" || value === "32" || value === "8192") setForm({ ...form, permission: value }); }}><option value="0">Tout le monde</option><option value="32">Gérer le serveur</option><option value="8192">Gérer les messages</option></select></label>
        {!builtIn && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ephemeral} disabled={busy} onChange={(e) => setForm({ ...form, ephemeral: e.target.checked })} />Réponse visible uniquement par la personne qui lance la commande</label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Annuler</Button><Button type="submit" disabled={busy}><Save className="h-4 w-4" /> {busy ? "Enregistrement…" : "Enregistrer"}</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Supprimer /{deleting?.name} ?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">La commande sera retirée de Discord sur tous les serveurs du bot.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Annuler</Button><Button variant="destructive" disabled={busy} onClick={async () => { if (deleting && await run(() => remove({ data: { id: deleting.id } }), "Commande supprimée")) setDeleting(null); }}>Supprimer</Button></div></DialogContent></Dialog>
  </>;
}