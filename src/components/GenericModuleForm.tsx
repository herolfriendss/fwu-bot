import { Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ModuleCatalogEntry } from "@/lib/module-catalog";
import { BOT_PROFILES } from "@/lib/bot-profiles";

type Chan = { id: string; name: string; type: number };
type Role = { id: string; name: string; managed: boolean };
const select = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const CHANNEL_TYPES: Record<string, number[]> = { textChannel: [0, 5], category: [4], voiceChannel: [2] };

/**
 * Form generated from a /setup module definition. Used for modules that have no hand-made
 * screen yet, so a module added on the bot side is configurable on the site straight away.
 */
export function GenericModuleForm({ module, value, onChange, channels, roles }: {
  module: ModuleCatalogEntry;
  value: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown>) => void;
  channels: Chan[];
  roles: Role[];
}) {
  const v = value ?? {};
  const set = (key: string, next: unknown) => onChange({ ...v, [key]: next });
  return (
    <section className="console-theme-panel space-y-4 p-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4" /> {module.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{module.description} · Géré par {BOT_PROFILES[module.owner].label}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {module.fields.map((field) => {
          const current = v[field.key];
          const id = `${module.key}-${field.key}`;
          if (field.kind === "boolean") return (
            <label key={field.key} className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={current === true} onCheckedChange={(on) => set(field.key, on)} /> {field.label.replace(/\s*\(oui\/non\)$/i, "")}
            </label>
          );
          if (field.kind === "integer") return (
            <div key={field.key}><Label htmlFor={id}>{field.label}</Label>
              <Input id={id} type="number" min={field.min} max={field.max} value={typeof current === "number" ? current : ""} onChange={(e) => set(field.key, Number(e.target.value))} /></div>
          );
          if (field.kind === "enum") return (
            <div key={field.key}><Label htmlFor={id}>{field.label}</Label>
              <select id={id} className={select} value={String(current ?? "")} onChange={(e) => set(field.key, e.target.value)}>
                {(field.values ?? []).map((option) => <option key={option} value={option}>{field.choices?.[option] ?? option}</option>)}
              </select></div>
          );
          if (field.kind === "role") return (
            <div key={field.key}><Label htmlFor={id}>{field.label.replace(/\s*\(ID\)$/, "")}</Label>
              <select id={id} className={select} value={String(current ?? "")} onChange={(e) => set(field.key, e.target.value || null)}>
                <option value="">Aucun</option>
                {roles.filter((r) => !r.managed).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></div>
          );
          if (field.kind in CHANNEL_TYPES) return (
            <div key={field.key}><Label htmlFor={id}>{field.label.replace(/\s*\(ID\)$/, "")}</Label>
              <select id={id} className={select} value={String(current ?? "")} onChange={(e) => set(field.key, e.target.value || null)}>
                <option value="">Aucun</option>
                {channels.filter((c) => CHANNEL_TYPES[field.kind]!.includes(c.type)).map((c) => <option key={c.id} value={c.id}>{field.kind === "category" ? c.name : `#${c.name}`}</option>)}
              </select></div>
          );
          if (field.kind === "roleList") {
            const ids = Array.isArray(current) ? current as string[] : [];
            return (
              <div key={field.key} className="sm:col-span-2"><Label>{field.label.replace(/\s*\(IDs.*\)$/, "")}</Label>
                <div className="mt-2 grid max-h-40 gap-2 overflow-auto sm:grid-cols-2">
                  {roles.filter((r) => !r.managed).map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={ids.includes(r.id)} disabled={!ids.includes(r.id) && ids.length >= 10}
                        onChange={(e) => set(field.key, e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))} /> {r.name}
                    </label>
                  ))}
                </div></div>
            );
          }
          if (field.kind === "text") return (
            <div key={field.key} className="sm:col-span-2"><Label htmlFor={id}>{field.label}</Label>
              <Textarea id={id} rows={2} maxLength={field.max} placeholder={field.placeholder} value={String(current ?? "")} onChange={(e) => set(field.key, e.target.value)} /></div>
          );
          return <p key={field.key} className="text-xs text-muted-foreground sm:col-span-2">{field.label} : à régler depuis Discord avec /setup.</p>;
        })}
      </div>
    </section>
  );
}
