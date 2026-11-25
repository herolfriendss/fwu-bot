import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getBotSettings, saveBotSettingsSections } from "@/lib/bot-settings.functions";
import { changedSections, DEFAULT_SETTINGS, type BotSettings, type DashboardSectionKey, type DashboardSectionPatch } from "@/lib/bot-settings";

/**
 * Edits a subset of the guild settings. Saving sends only the sections that changed, together
 * with the values they started from, so the server can refuse a stale edit instead of
 * overwriting a change made from Discord in the meantime.
 */
export function useSectionSettings(guildId: string, keys: readonly DashboardSectionKey[], onDirtyChange?: (dirty: boolean) => void) {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getBotSettings);
  const saveSections = useServerFn(saveBotSettingsSections);
  const q = useQuery({ queryKey: ["bot-settings", guildId], queryFn: () => fetchSettings({ data: { guildId } }), enabled: !!guildId });
  const [s, setS] = useState<BotSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);

  const patch = useMemo<DashboardSectionPatch>(() => (q.data ? changedSections(s, q.data, keys) : {}), [s, q.data, keys]);
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const set = <K extends keyof BotSettings>(key: K, value: Partial<BotSettings[K]> | BotSettings[K]) =>
    setS((prev) => ({ ...prev, [key]: Array.isArray(value) ? value : { ...(prev[key] as object), ...(value as object) } }));

  async function save(transform?: (patch: DashboardSectionPatch) => DashboardSectionPatch) {
    if (!q.data) return;
    const toSend = transform ? transform(patch) : patch;
    const sectionKeys = Object.keys(toSend) as DashboardSectionKey[];
    if (!sectionKeys.length) { toast.info("Aucune modification à enregistrer."); return; }
    const base = Object.fromEntries(sectionKeys.map((key) => [key, q.data![key]]));
    setSaving(true);
    try {
      const saved = await saveSections({ data: { guildId, patch: toSend, base } });
      qc.setQueryData(["bot-settings", guildId], saved);
      toast.success("Réglages enregistrés : le bot les applique d’ici 1 minute.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return { q, s, setS, set, dirty, saving, save };
}
