const errorCode = (payload) => typeof payload?.error === "string" ? payload.error : "";

/**
 * Converts the dashboard AI API status into actionable Discord feedback.
 * The raw provider response is deliberately not exposed to members.
 */
export function describePndAiFailure(status, payload, task = "chat") {
  const code = errorCode(payload);
  const subject = task === "action" ? "Le planificateur PND Intelligence" : "PND Intelligence";

  if (status === 401) return "La synchronisation bot/dashboard est refusée : vérifie BOT_SYNC_SECRET dans les deux environnements.";
  if (status === 402 || code === "credits") return "Les crédits IA sont épuisés. Vérifie le solde ou la facturation de ta passerelle IA.";
  if (status === 429 || code === "rate_limited") return "La passerelle IA limite temporairement les demandes. Réessaie dans un instant.";
  if (status === 403 || status === 404) return "Le modèle IA configuré n’est pas disponible sur cette passerelle. Vérifie son identifiant et les modèles autorisés.";
  if (code === "ai not configured") return `${subject} n’est pas configurée : ajoute LOVABLE_API_KEY ou AI_GATEWAY_API_KEY dans les secrets serveur, puis redéploie le dashboard.`;
  if (code === "empty_ai_response") return "La passerelle IA n’a renvoyé aucun texte. Vérifie le modèle et réessaie.";
  if (status === 503) return `${subject} est temporairement indisponible. Vérifie les secrets Supabase et IA ainsi que les logs du dashboard.`;
  if (status >= 500) return `${subject} a rencontré une erreur côté passerelle. Vérifie LOVABLE_API_KEY / AI_GATEWAY_API_KEY, l’identifiant du modèle et les logs du dashboard.`;
  return `${subject} n’a pas pu traiter cette demande (HTTP ${status || "inconnu"}).`;
}
