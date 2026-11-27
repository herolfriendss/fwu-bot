/** Safe, user-facing error descriptions for SYS+ writes to the dashboard API. */
export async function readSyncResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 160) };
  }
}

export function describeIntelligenceSyncFailure(status, payload) {
  const code = typeof payload?.error === "string" ? payload.error : "";
  if (status === 401) return "Le secret BOT_SYNC_SECRET du bot ne correspond pas à celui du site.";
  if (status === 403) return "Le site ne reconnaît pas ton identifiant comme owner : PND_OWNER_DISCORD_ID du site (.env à la racine) n'est pas le même que celui de ce bot, ou le site n'a pas redémarré avec.";
  if (status === 404) return "L’API de synchronisation du site est introuvable. Le dashboard doit être redéployé avec cette version.";
  if (status === 400) return "Le site a refusé les identifiants Discord transmis. Vérifie le serveur et le salon sélectionné.";
  if (status === 413) return "La configuration envoyée est trop volumineuse.";
  if (code === "bot_settings_table_missing") return "La table Supabase public.bot_settings est absente. Applique la migration supabase/migrations/202611200001_bot_settings_sync.sql puis réessaie.";
  if (code === "bot_settings_permission_denied") return "Supabase refuse l’accès en écriture à bot_settings. Vérifie que le dashboard utilise la clé service_role côté serveur et que la migration accorde les droits à service_role.";
  if (code === "supabase_not_configured") return "Le dashboard n’a pas de connexion Supabase serveur valide. Configure SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans les secrets du dashboard, puis redéploie.";
  if (status === 503 || code === "settings_persistence_failed") return "Le site n’a pas réussi à enregistrer les réglages dans Supabase. Vérifie les logs du dashboard et l’existence de public.bot_settings.";
  if (status >= 500) return `Le serveur du dashboard a répondu HTTP ${status}. Consulte ses logs pour identifier l’erreur Supabase.`;
  if (status) return `Le dashboard a refusé la synchronisation (HTTP ${status}${code ? ` · ${code}` : ""}).`;
  return "Connexion au dashboard impossible. Vérifie SITE_URL, le DNS et la disponibilité du site.";
}
