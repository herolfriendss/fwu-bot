// Her? V4 — met à jour un module de réglages via le dashboard.
//
// Le bot ne parle jamais directement à Supabase : l’endpoint bot-sync valide et
// fusionne les réglages, puis renvoie l’objet complet assaini. Les réglages des
// autres modules, du vocal et des commandes préfixées sont préservés.
//
// `changes` (champs modifiés) et `expected` (leur valeur juste avant) permettent
// au serveur d’appliquer seulement ces champs et de refuser un conflit ;
// `settings` reste envoyé pour les versions du serveur qui ne les lisent pas.
export async function updateModuleSettings({ apiUrl, secret, guildId, module, value, changes, expected, actorId }) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ action: "module-settings", guildId, module, settings: value, changes, expected, actorId }),
  });
  if (response.status === 409) {
    const error = new Error("Conflit de réglages.");
    error.conflict = true;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.settings) throw new Error("Réglages absents de la réponse.");
  return data.settings;
}
