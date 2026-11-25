import { z } from "zod";
import { labelAuthors } from "./privacy.js";

/** L'Observateur : transforme une semaine d'activité en propositions concrètes. */

export const OBSERVER_MODEL = "claude-haiku-5-5";
export const OBSERVER_MAX_TOKENS = 8000;

export const BOTS = [
  "FWU (slash) : modération staff, embeds, règlement IA, logs",
  "GUARD (+) : ban, kick, purge, lock, anti-spam, vérification",
  "FDPDLAVOC (;) : musique, radio, vocaux temporaires, accès vocaux",
  "SUCK ME (=) : SYS+, rôles, DOG, MENOTTE, tickets, IA, giveaways, événements",
  "LE FISC (-) : économie, casino, jeux, cartes",
];

export const ProposalSchema = z.object({
  type: z.enum(["fonctionnalite", "correctif"]),
  titre: z.string(),
  description: z.string(),
  pourquoi: z.string(),
  bot_concerne: z.enum(["FWU", "GUARD", "FDPDLAVOC", "SUCK ME", "LE FISC", "serveur"]),
  priorite: z.enum(["haute", "moyenne", "basse"]),
  effort: z.enum(["petit", "moyen", "gros"]),
});

export const ObserverOutputSchema = z.object({
  resume: z.string(),
  propositions: z.array(ProposalSchema),
});

export const SYSTEM_PROMPT = `Tu es l'Observateur d'un serveur Discord francophone qui utilise 5 bots maison :
${BOTS.map((b) => `- ${b}`).join("\n")}

On te donne une semaine d'activité : chiffres par salon, commandes utilisées et leurs erreurs, arrivées et départs, et des extraits anonymisés de messages (bugs signalés, idées, questions, messages d'erreur des bots).

Ta mission : proposer au propriétaire du serveur entre 0 et 5 améliorations concrètes, des nouvelles fonctionnalités ou des correctifs.

Règles :
- Chaque proposition s'appuie sur ce que montrent les données. Dans « pourquoi », cite les chiffres ou les extraits qui la justifient. Si les données ne montrent rien de clair, propose moins, voire rien.
- N'essaie jamais d'identifier un membre. Les extraits disent « membre A », « membre B » : ne les cite pas.
- Ne propose pas ce qui figure déjà dans la liste des propositions récentes.
- Ne propose jamais de lire les messages privés, de surveiller des membres en particulier ou de sanctionner quelqu'un.
- Écris en français simple : le propriétaire n'est pas développeur. Titre court (moins de 80 caractères).
- « resume » : 3 à 5 phrases sur la semaine du serveur (activité, ce qui marche, ce qui coince).`;

/** Construit le message envoyé à l'IA. Les salons sont désignés par leur nom, pas leur identifiant. */
export function buildObservationPrompt(window, recentTitles, channelNames = new Map()) {
  const name = (id) => channelNames.get(id) ?? "salon";
  const excerpts = labelAuthors(window.excerpts).map(
    (e) => `[${e.day}] #${name(e.channel_id)} (${e.kind}) ${e.author} : ${e.content}`,
  );
  const data = {
    salons: window.channels.map((c) => ({
      salon: name(c.channel_id),
      messages: c.messages,
      membres_actifs_max_par_jour: c.max_authors_per_day,
      jours_actifs: c.active_days,
    })),
    commandes: window.commands,
    arrivees_departs: window.flow,
  };
  return [
    "## Chiffres des 7 derniers jours",
    JSON.stringify(data, null, 1),
    "## Extraits anonymisés",
    excerpts.length ? excerpts.join("\n") : "(aucun)",
    "## Propositions récentes (ne pas répéter)",
    recentTitles.length ? recentTitles.map((t) => `- ${t.title} (${t.status})`).join("\n") : "(aucune)",
  ].join("\n\n");
}

/** Clé anti-doublon : même titre à la casse, aux accents et à la ponctuation près. */
export function dedupKey(title) {
  return String(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Appelle l'IA. `client` est un client Anthropic (injectable pour les tests). */
export async function runObserver({ client, prompt }) {
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const response = await client.messages.parse({
    model: OBSERVER_MODEL,
    max_tokens: OBSERVER_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(ObserverOutputSchema) },
  });
  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") return { ok: false, reason: "refus du modèle", usage };
  if (response.stop_reason === "max_tokens") return { ok: false, reason: "réponse coupée (trop longue)", usage };
  const parsed = response.parsed_output;
  if (!parsed) return { ok: false, reason: "réponse illisible", usage };
  return { ok: true, result: { ...parsed, propositions: parsed.propositions.slice(0, 5) }, usage };
}
