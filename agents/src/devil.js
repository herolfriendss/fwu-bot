import { z } from "zod";

/**
 * L'Avocat du diable : relit chaque proposition des autres agents avant
 * qu'elle n'arrive dans #agents, et cherche ce qui pourrait clocher.
 * Modèle plus solide que l'Observateur, car c'est un travail de jugement.
 */

export const DEVIL_MODEL = "claude-sonnet-5-5";
export const DEVIL_MAX_TOKENS = 8000;

export const CritiqueSchema = z.object({
  numero: z.number().int(),
  objections: z.string(),
  risques: z.string(),
  question_cle: z.string(),
  verdict: z.enum(["garder", "revoir", "abandonner"]),
});

export const DevilOutputSchema = z.object({ critiques: z.array(CritiqueSchema) });

export const DEVIL_SYSTEM = `Tu es l'Avocat du diable d'une petite équipe d'agents qui gère un serveur Discord francophone et ses 5 bots maison.
D'autres agents font des propositions au propriétaire du serveur. Ton rôle est de les remettre en question pour qu'il ne valide que les bonnes.

Pour chaque proposition :
- « objections » : les meilleurs arguments contre. Les preuves sont-elles solides ou tirées d'un ou deux messages ? Existe-t-il plus simple ? Est-ce que ça existe déjà dans un des bots ?
- « risques » : ce qui peut mal tourner (membres mécontents, abus, charge sur un VPS de 500 Mo de RAM déjà plein, maintenance, vie privée).
- « question_cle » : la question que le propriétaire devrait se poser avant de valider.
- « verdict » : « garder » si la proposition tient malgré tes objections, « revoir » si elle mérite d'être retravaillée, « abandonner » si elle n'en vaut pas la peine.

Sois exigeant mais honnête : si une proposition est bonne, dis-le et garde des objections courtes. Ne critique pas pour le plaisir.
Français simple, 2 à 3 phrases par champ au maximum. « numero » reprend le numéro de la proposition.`;

export function buildDevilPrompt(propositions, contexte) {
  const list = propositions
    .map(
      (p, i) =>
        `### Proposition ${i + 1} : ${p.titre}\nType : ${p.type} · concerne : ${p.bot_concerne} · priorité : ${p.priorite} · effort : ${p.effort}\n${p.description}\nJustification donnée : ${p.pourquoi}`,
    )
    .join("\n\n");
  return `## Contexte (résumé de la semaine)\n${contexte || "(aucun)"}\n\n## Propositions à challenger\n${list}`;
}

/** Renvoie une critique par proposition (null si elle manque), plus l'usage pour le budget. */
export async function runDevil({ client, propositions, contexte }) {
  if (!propositions.length) return { ok: true, critiques: [], usage: { inputTokens: 0, outputTokens: 0 }, model: DEVIL_MODEL };
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const response = await client.beta.messages.parse({
    model: DEVIL_MODEL,
    max_tokens: DEVIL_MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: DEVIL_SYSTEM,
    messages: [{ role: "user", content: buildDevilPrompt(propositions, contexte) }],
    output_config: { format: zodOutputFormat(DevilOutputSchema) },
  });
  const usage = { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
  const model = response.model ?? DEVIL_MODEL;
  if (response.stop_reason !== "end_turn" || !response.parsed_output)
    return { ok: false, reason: response.stop_reason === "refusal" ? "refus du modèle" : "réponse incomplète", usage, model };
  const byNumber = new Map(response.parsed_output.critiques.map((c) => [c.numero, c]));
  return { ok: true, critiques: propositions.map((_, i) => byNumber.get(i + 1) ?? null), usage, model };
}
