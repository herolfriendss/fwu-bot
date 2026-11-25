// Configuration check shown on the dashboard. Pure and shared-rule based: module requirements
// come from the same setupRequirementError() the Discord /setup uses.
import { SETUP_MODULES, setupRequirementError } from "../../bot/systems/setup/policy.js";
import type { BotSettings } from "./bot-settings";

export type DiagnosticIssue = { level: "error" | "warning" | "info"; module: string; message: string };
type Chan = { id: string; name: string; type: number };
type Role = { id: string; name: string };

const CHANNEL_KINDS = new Set(["textChannel", "category", "voiceChannel"]);

export function diagnoseSettings(settings: BotSettings, { channels, roles }: { channels: Chan[]; roles: Role[] }): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const all = settings as unknown as Record<string, Record<string, unknown> | undefined>;

  for (const [key, def] of Object.entries(SETUP_MODULES)) {
    const value = all[key];
    if (!value) continue;
    const enabled = def.fields.some((f) => f.key === "enabled") ? value["enabled"] === true : true;
    const requirement = enabled ? setupRequirementError(key, value) : null;
    if (requirement) issues.push({ level: "error", module: def.label, message: requirement });
    for (const field of def.fields) {
      const raw = value[field.key];
      const label = field.label.replace(/\s*\(IDs?.*\)$/, "");
      if (CHANNEL_KINDS.has(field.kind) && typeof raw === "string" && !channelIds.has(raw)) {
        issues.push({ level: enabled ? "error" : "warning", module: def.label, message: `« ${label} » désigne un salon qui n’existe plus.` });
      }
      if (field.kind === "role" && typeof raw === "string" && !roleIds.has(raw)) {
        issues.push({ level: enabled ? "error" : "warning", module: def.label, message: `« ${label} » désigne un rôle qui n’existe plus.` });
      }
      if (field.kind === "roleList" && Array.isArray(raw)) {
        const missing = raw.filter((id) => typeof id === "string" && !roleIds.has(id)).length;
        if (missing) issues.push({ level: "warning", module: def.label, message: `« ${label} » contient ${missing} rôle(s) supprimé(s).` });
      }
    }
  }

  if (!settings.logs.channelId) issues.push({ level: "info", module: "Journal centralisé", message: "Aucun salon de journal : les événements des modules ne sont enregistrés nulle part." });
  else if (!channelIds.has(settings.logs.channelId)) issues.push({ level: "error", module: "Journal centralisé", message: "Le salon de journal n’existe plus." });
  if (settings.welcome.enabled && !channelIds.has(settings.welcome.channelId)) issues.push({ level: "error", module: "Message de bienvenue", message: "Le message de bienvenue est activé sans salon valide." });
  if (settings.sysPlus.roleId && !roleIds.has(settings.sysPlus.roleId)) issues.push({ level: "error", module: "SYS+", message: "Le rôle SYS+ n’existe plus : à corriger avec /sysp role." });
  if (settings.sysPlus.intelligenceEnabled && (!settings.sysPlus.intelligenceChannelId || !channelIds.has(settings.sysPlus.intelligenceChannelId))) {
    issues.push({ level: "error", module: "PND Intelligence", message: "PND Intelligence est activée sans salon valide : à corriger avec /sysp intelligence-channel." });
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}
