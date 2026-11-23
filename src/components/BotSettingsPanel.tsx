import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Plus, Save, Server, Trash2 } from "lucide-react";
import { getBotConnection, getBotSettings, saveBotSettings } from "@/lib/bot-settings.functions";
import { DEFAULT_SETTINGS, type BotSettings } from "@/lib/bot-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Chan = { id: string; name: string };

export function BotSettingsPanel({ guildId, channels }: { guildId: string; channels: Chan[] }) {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getBotSettings);
  const save = useServerFn(saveBotSettings);
  const fetchConn = useServerFn(getBotConnection);
  const q = useQuery({ queryKey: ["bot-settings", guildId], queryFn: () => fetchSettings({ data: { guildId } }), enabled: !!guildId });
  const conn = useQuery({ queryKey: ["bot-connection"], queryFn: () => fetchConn() });
  const [s, setS] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [words, setWords] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data) {
      setS(q.data);
      setWords(q.data.filter.words.join(", "));
    }
  }, [q.data]);

  const set = <K extends keyof BotSettings>(k: K, v: Partial<BotSettings[K]>) => setS((p) => ({ ...p, [k]: Array.isArray(v) ? v : { ...(p[k] as object), ...v } }));
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";

  async function onSave() {
    setSaving(true);
    try {
      const filterWords = words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
      const saved = await save({ data: { guildId, settings: { ...s, filter: { ...s.filter, words: filterWords } } } });
      qc.setQueryData(["bot-settings", guildId], saved);
      toast.success("Réglages enregistrés : le bot les applique d’ici 1 minute.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copié"));

  if (!guildId) return <p className="text-muted-foreground">Choisis un serveur.</p>;
  if (q.isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (q.error) return <p className="text-destructive">{q.error.message}</p>;

  return (
    <section className="space-y-8">
      <div className="console-theme-panel p-4 space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><Server className="h-5 w-5" /> Liaison avec ton serveur (VPS)</h2>
        <p className="text-sm text-muted-foreground">Le bot tourne sur ton VPS et lit ces réglages toutes les minutes. Mets ces deux valeurs dans le fichier <code>.env</code> du bot (voir le guide du dossier <code>bot</code>).</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="rounded bg-muted px-2 py-1 break-all">SITE_URL={siteUrl}</code>
          <Button size="sm" variant="outline" onClick={() => copy(`SITE_URL=${siteUrl}`)}><Copy className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Secret de liaison : {conn.data ? (conn.data.configured ? "configuré et protégé" : "non configuré") : "vérification…"}</span>
          <Button asChild size="sm" variant="outline"><Link to="/installation">Installation Oracle</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/statut">Statut du bot</Link></Button>
        </div>
      </div>

      <div className="console-theme-panel p-4 space-y-3">
        <h3 className="font-semibold">Mots-clés → réponses</h3>
        {s.keywords.map((k, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto] items-center">
            <Input placeholder="mot-clé" value={k.trigger} onChange={(e) => set("keywords", s.keywords.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)))} />
            <Input placeholder="réponse du bot" value={k.response} onChange={(e) => set("keywords", s.keywords.map((x, j) => (j === i ? { ...x, response: e.target.value } : x)))} />
            <label className="flex items-center gap-2 text-xs"><Switch checked={k.exact} onCheckedChange={(v) => set("keywords", s.keywords.map((x, j) => (j === i ? { ...x, exact: v } : x)))} /> Message exact</label>
            <Button size="icon" variant="ghost" aria-label="Supprimer" onClick={() => set("keywords", s.keywords.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set("keywords", [...s.keywords, { trigger: "", response: "", exact: false }])}><Plus className="h-4 w-4" /> Ajouter un mot-clé</Button>
      </div>

      <div className="console-theme-panel p-4 space-y-3">
        <div className="flex items-center gap-3"><Switch checked={s.filter.enabled} onCheckedChange={(v) => set("filter", { enabled: v })} /><h3 className="font-semibold">Filtre anti-insultes</h3></div>
        <Label>Mots interdits (séparés par des virgules)</Label>
        <Textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} />
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.filter.deleteMessage} onCheckedChange={(v) => set("filter", { deleteMessage: v })} /> Supprimer le message</label>
        <Label>Avertissement ({"{user}"} = la personne)</Label>
        <Input value={s.filter.warn} onChange={(e) => set("filter", { warn: e.target.value })} />
      </div>

      <div className="console-theme-panel p-4 space-y-3">
        <div className="flex items-center gap-3"><Switch checked={s.spam.enabled} onCheckedChange={(v) => set("spam", { enabled: v })} /><h3 className="font-semibold">Anti-spam</h3></div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Plus de <Input type="number" className="w-20" value={s.spam.maxMessages} onChange={(e) => set("spam", { maxMessages: Number(e.target.value) })} /> messages en
          <Input type="number" className="w-20" value={s.spam.perSeconds} onChange={(e) => set("spam", { perSeconds: Number(e.target.value) })} /> secondes → sourdine de
          <Input type="number" className="w-24" value={s.spam.timeoutMinutes} onChange={(e) => set("spam", { timeoutMinutes: Number(e.target.value) })} /> minutes
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Maximum de mentions par message : <Input type="number" min={2} max={20} className="w-20" value={s.spam.maxMentions} onChange={(e) => set("spam", { maxMentions: Number(e.target.value) })} />
        </label>
        <p className="text-xs text-muted-foreground">Une rafale supprime le message et applique le même timeout. Le bot doit avoir Gérer les messages et Modérer les membres.</p>
      </div>

      <div className="console-theme-panel p-4 space-y-3">
        <div className="flex items-center gap-3"><Switch checked={s.welcome.enabled} onCheckedChange={(v) => set("welcome", { enabled: v })} /><h3 className="font-semibold">Message de bienvenue</h3></div>
        <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={s.welcome.channelId} onChange={(e) => set("welcome", { channelId: e.target.value })}>
          <option value="">— Choisir un salon —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <Label>Message ({"{user}"} = nouveau membre, {"{server}"} = nom du serveur)</Label>
        <Textarea value={s.welcome.message} onChange={(e) => set("welcome", { message: e.target.value })} rows={2} />
      </div>

      <div className="console-theme-panel p-4 space-y-3">
        <div className="flex items-center gap-3"><Switch checked={s.ai.enabled} onCheckedChange={(v) => set("ai", { enabled: v })} /><h3 className="font-semibold">Réponses par l’IA (quand on mentionne le bot)</h3></div>
        <Label>Personnalité du bot</Label>
        <Textarea value={s.ai.instructions} onChange={(e) => set("ai", { instructions: e.target.value })} rows={3} />
      </div>

      <Button onClick={onSave} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer"}</Button>
    </section>
  );
}
