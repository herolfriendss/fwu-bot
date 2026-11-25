/**
 * Suivi du coût de l'IA. Prix en dollars par million de jetons (tarifs
 * publics Anthropic de novembre 2026 ; à mettre à jour s'ils changent).
 */
export const PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  // modèle de repli éventuel de Sonnet 5.5 (même prix)
  "claude-sonnet-5": { input: 2, output: 10 },
};

/** Prix d'un modèle, ou de `fallbackModel` si le nom renvoyé par l'API est inconnu. */
export function priceModel(model, fallbackModel) {
  return PRICES[model] ? model : fallbackModel;
}

export const PAUSE_RATIO = 0.9;

export function costUsd(model, inputTokens, outputTokens) {
  const p = PRICES[model];
  if (!p) throw new Error(`prix inconnu pour le modèle ${model}`);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/**
 * Autorise un appel si, même dans le pire cas (tous les jetons de sortie
 * utilisés), la dépense du mois reste sous 90 % du plafond.
 */
export function canSpend({ spentUsd, budgetUsd, model, estimatedInputTokens, maxOutputTokens }) {
  const worst = costUsd(model, estimatedInputTokens, maxOutputTokens);
  const limit = budgetUsd * PAUSE_RATIO;
  return { allowed: spentUsd + worst <= limit, worstCaseUsd: worst, limitUsd: limit };
}

/** Estimation grossière : environ 3,5 caractères par jeton en français. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 3.5);
}
