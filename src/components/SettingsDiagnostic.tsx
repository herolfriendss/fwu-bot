import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { BotSettings } from "@/lib/bot-settings";
import { diagnoseSettings } from "@/lib/settings-diagnostic";

type Chan = { id: string; name: string; type: number };
type Role = { id: string; name: string };
const ICONS = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const COLORS = { error: "text-destructive", warning: "text-amber-300", info: "text-muted-foreground" } as const;

/** Lists what is misconfigured in the saved settings (not the unsaved edits). */
export function SettingsDiagnostic({ settings, channels, roles }: { settings: BotSettings; channels: Chan[]; roles: Role[] }) {
  const issues = diagnoseSettings(settings, { channels, roles });
  const errors = issues.filter((i) => i.level === "error").length;
  return (
    <section className="console-theme-panel space-y-3 p-4" aria-labelledby="diagnostic-title">
      <h3 id="diagnostic-title" className="flex items-center gap-2 font-semibold">
        {errors ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-signal" />}
        Diagnostic de la configuration
      </h3>
      {!issues.length && <p className="text-sm text-muted-foreground">Tout est en ordre : chaque module activé a ses salons et rôles.</p>}
      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((issue, i) => {
            const Icon = ICONS[issue.level];
            return (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${COLORS[issue.level]}`} />
                <span><strong className="font-medium">{issue.module}</strong> : {issue.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
