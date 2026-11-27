// FWU — génération du règlement avec l'API Claude.
// La clé reste côté VPS : ANTHROPIC_API_KEY dans bot/.env (jamais dans le code).
// Sortie structurée (schéma JSON) puis contrôle local : nombre de règles,
// longueurs, absence de doublon. Un brouillon invalide n'est jamais proposé.
import Anthropic from "@anthropic-ai/sdk";

export const RULES_MODEL = "claude-opus-5-5";
export const MIN_RULES = 5;
export const MAX_RULES = 20;

const RULES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Tu rédiges le règlement d'un serveur Discord francophone.
Exigences, toutes obligatoires :
- Chaque règle couvre un sujet distinct : aucun doublon, aucune règle qui en reformule une autre.
- Les règles forment un ensemble cohérent : aucune ne contredit, n'affaiblit ou ne fait exception à une autre.
- Titre court (2 à 6 mots, sans numéro). Description claire et applicable, 1 à 3 phrases, au plus 300 caractères.
- Ton respectueux et direct, vouvoiement ou tutoiement constant sur tout le règlement.
- Couvre l'essentiel d'une communauté : respect, discriminations, contenus interdits, spam et publicité, vie privée, salons vocaux, respect des décisions du staff et des conditions d'utilisation de Discord — sauf si les consignes de l'administrateur disent autrement.
- Aucune sanction chiffrée (les durées sont gérées par le bot), pas de Markdown, pas d'emoji.`;

let client = null;
function defaultClient() {
  if (!String(process.env.ANTHROPIC_API_KEY ?? "").trim()) {
    throw new Error("ANTHROPIC_API_KEY n'est pas configurée dans bot/.env : génération IA indisponible.");
  }
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
  return client;
}

const normalize = (text) => String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STOP_WORDS = new Set(["le", "la", "les", "de", "des", "du", "et", "en", "un", "une", "a", "au", "aux", "pas", "ne", "sur", "pour", "dans", "est", "sont", "ou", "par", "vos", "votre", "tes", "ton", "ta", "se", "sa", "son"]);
function words(text) {
  return new Set(normalize(text).split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return common / (a.size + b.size - common);
}

/**
 * Local checks on a generated rulebook. Returns { ok, rules, problems }.
 * Duplicates: same normalized title, or titles+descriptions too similar.
 */
export function validateRules(raw, expectedCount = null) {
  const problems = [];
  const rules = (Array.isArray(raw) ? raw : [])
    .map((rule) => ({ title: String(rule?.title ?? "").trim().replace(/^\d+[.)-]\s*/, ""), description: String(rule?.description ?? "").trim() }))
    .filter((rule) => rule.title && rule.description);
  if (rules.length < MIN_RULES || rules.length > MAX_RULES) problems.push(`nombre de règles invalide (${rules.length})`);
  if (expectedCount && Math.abs(rules.length - expectedCount) > 1) problems.push(`${rules.length} règles au lieu de ${expectedCount}`);
  for (const [index, rule] of rules.entries()) {
    if (rule.title.length > 80) problems.push(`titre trop long (règle ${index + 1})`);
    if (rule.description.length > 400) problems.push(`description trop longue (règle ${index + 1})`);
  }
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const sameTitle = normalize(rules[i].title) === normalize(rules[j].title);
      const similar = jaccard(words(`${rules[i].title} ${rules[i].description}`), words(`${rules[j].title} ${rules[j].description}`)) >= 0.6;
      if (sameTitle || similar) problems.push(`règles ${i + 1} et ${j + 1} en doublon`);
    }
  }
  return { ok: problems.length === 0, rules, problems };
}

function buildPrompt({ guildName, consignes, count, previousProblems }) {
  return [
    `Serveur : ${String(guildName ?? "communauté").slice(0, 100)}`,
    `Nombre de règles : exactement ${count}.`,
    consignes ? `Consignes de l'administrateur (prioritaires si elles ne violent pas les exigences) :\n${String(consignes).slice(0, 1000)}` : "Aucune consigne particulière.",
    previousProblems?.length ? `La version précédente a été rejetée pour : ${previousProblems.join(" ; ")}. Corrige ces points.` : "",
  ].filter(Boolean).join("\n\n");
}

async function askClaude(anthropic, prompt) {
  const response = await anthropic.beta.messages.create({
    model: RULES_MODEL,
    max_tokens: 16000,
    // Repli automatique si la requête est déclinée par un filtre de sécurité.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: RULES_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("L'IA a refusé de générer ce règlement : reformule les consignes.");
  if (response.stop_reason === "max_tokens") throw new Error("Réponse de l'IA incomplète : réessaie avec moins de règles.");
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  try {
    return JSON.parse(text).rules;
  } catch {
    throw new Error("Réponse de l'IA illisible : réessaie.");
  }
}

/**
 * Generate a validated rulebook. One automatic retry with the problems found.
 * `anthropic` is injectable for tests.
 */
export async function generateRules({ guildName, consignes = "", count = 10, anthropic = null } = {}) {
  const wanted = Math.min(MAX_RULES, Math.max(MIN_RULES, Number(count) || 10));
  const api = anthropic ?? defaultClient();
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try {
      raw = await askClaude(api, buildPrompt({ guildName, consignes, count: wanted, previousProblems: problems }));
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(error.status === 429 ? "Service IA saturé : réessaie dans une minute." : "Service IA indisponible pour le moment.");
      }
      throw error;
    }
    const checked = validateRules(raw, wanted);
    if (checked.ok) return checked.rules;
    problems = checked.problems;
  }
  throw new Error(`Le règlement généré ne respecte pas les exigences (${problems.slice(0, 3).join(" ; ")}). Relance la génération.`);
}

/** Rules → embed descriptions of at most 4 000 characters each. */
export function rulesToEmbedPages(rules, maxLength = 4000) {
  const pages = [];
  let current = "";
  rules.forEach((rule, index) => {
    const block = `**${index + 1}. ${rule.title}**\n${rule.description}\n\n`;
    if (current && current.length + block.length > maxLength) {
      pages.push(current.trim());
      current = "";
    }
    current += block;
  });
  if (current.trim()) pages.push(current.trim());
  return pages;
}

/** Règles → texte éditable, une règle par ligne : « Titre : description ». */
export function rulesToText(rules) {
  return (rules ?? []).map((rule) => `${rule.title} : ${rule.description}`).join("\n");
}

/**
 * Texte écrit par un admin → règles. Une règle par ligne (« Titre : description », « Titre - description »
 * ou « Titre — description »), numéros en tête ignorés. Une ligne sans séparateur prolonge la règle précédente.
 */
export function parseRulesText(text) {
  const rules = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^(?:\d+\s*[.)-]|[-•*])\s*/, "").replace(/\*\*/g, "");
    if (!line) continue;
    const match = line.match(/^(.{2,80}?)\s*(?::|\s[-—–]\s)\s*(.+)$/);
    if (match) rules.push({ title: match[1].trim(), description: match[2].trim() });
    else if (rules.length) rules.at(-1).description = `${rules.at(-1).description} ${line}`.trim();
    else throw new Error(`Ligne sans titre : « ${line.slice(0, 60)} ». Écris « Titre : description ».`);
  }
  return rules;
}
