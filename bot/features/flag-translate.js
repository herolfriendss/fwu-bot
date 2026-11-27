// SUCK ME — traduction par drapeau : réagir avec un drapeau (🇬🇧, 🇪🇸, 🇩🇪…) sous un message
// le fait traduire dans cette langue par l'IA (API Claude, clé ANTHROPIC_API_KEY déjà utilisée
// pour le règlement). Une seule traduction par message et par langue, 10 s entre deux demandes
// par membre, 1 500 caractères au plus. Désactivable avec PND_FLAG_TRANSLATE=off.
import Anthropic from "@anthropic-ai/sdk";

export const TRANSLATE_MODEL = "claude-haiku-5-5";
export const TRANSLATE = Object.freeze({ maxChars: 1_500, userCooldownMs: 10_000, cacheSize: 2_000 });

const FLAG_LANGUAGES = Object.freeze({
  FR: "français", BE: "français", CH: "français", CA: "français",
  GB: "anglais", US: "anglais", AU: "anglais", IE: "anglais",
  ES: "espagnol", MX: "espagnol", AR: "espagnol", DE: "allemand", AT: "allemand", IT: "italien",
  PT: "portugais", BR: "portugais", NL: "néerlandais", RU: "russe", UA: "ukrainien", PL: "polonais",
  TR: "turc", JP: "japonais", CN: "chinois simplifié", TW: "chinois traditionnel", KR: "coréen",
  SA: "arabe", MA: "arabe", DZ: "arabe", TN: "arabe", EG: "arabe", IN: "hindi", GR: "grec",
  SE: "suédois", NO: "norvégien", DK: "danois", FI: "finnois", RO: "roumain", VN: "vietnamien", IL: "hébreu",
});

/** "🇬🇧" → { code: "GB", language: "anglais" } ; null pour un autre émoji ou un drapeau non pris en charge. */
export function flagLanguage(emoji) {
  const chars = [...String(emoji ?? "")];
  if (chars.length !== 2) return null;
  const code = chars.map((c) => {
    const point = c.codePointAt(0);
    return point >= 0x1f1e6 && point <= 0x1f1ff ? String.fromCharCode(point - 0x1f1e6 + 65) : "";
  }).join("");
  if (code.length !== 2 || !FLAG_LANGUAGES[code]) return null;
  return { code, language: FLAG_LANGUAGES[code] };
}

const done = new Set(); // `${messageId}:${language}`
const lastAsk = new Map(); // userId → horodatage

/** Garde-fous purs : rend la raison du refus, ou null si la demande passe (et la note). */
export function translationGate({ messageId, language, userId, now = Date.now() }) {
  const key = `${messageId}:${language}`;
  if (done.has(key)) return "déjà traduit";
  if (lastAsk.has(userId) && now - lastAsk.get(userId) < TRANSLATE.userCooldownMs) return "trop rapide";
  lastAsk.delete(userId); lastAsk.set(userId, now);
  if (lastAsk.size > TRANSLATE.cacheSize) lastAsk.delete(lastAsk.keys().next().value);
  done.add(key);
  if (done.size > TRANSLATE.cacheSize) done.delete(done.values().next().value);
  return null;
}

export function forgetTranslations() { done.clear(); lastAsk.clear(); }

let client = null;
function defaultClient() {
  if (!String(process.env.ANTHROPIC_API_KEY ?? "").trim()) return null;
  client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
  return client;
}

/** Traduit `text` en `language`. `anthropic` injectable pour les tests. */
export async function translate(text, language, { anthropic = defaultClient() } = {}) {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY absente : traduction indisponible.");
  const response = await anthropic.messages.create({
    model: TRANSLATE_MODEL,
    max_tokens: 2_000,
    system: `Tu traduis des messages Discord. Réponds uniquement par la traduction en ${language}, sans guillemets, sans commentaire ni explication. Garde le ton, les émojis et les mentions telles quelles. Si le texte est déjà en ${language}, renvoie-le tel quel.`,
    messages: [{ role: "user", content: String(text).slice(0, TRANSLATE.maxChars) }],
  });
  const out = response.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
  if (!out || response.stop_reason === "refusal") throw new Error("traduction refusée");
  return out.slice(0, 1_900);
}

/** messageReactionAdd. Rend true si une traduction a été postée. */
export async function handleFlagReaction(reaction, user, { env = process.env, anthropic, now = Date.now() } = {}) {
  if (String(env.PND_FLAG_TRANSLATE ?? "").toLowerCase() === "off" || user?.bot) return false;
  const target = flagLanguage(reaction?.emoji?.name);
  if (!target) return false;
  const message = reaction.message?.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  const text = String(message?.content ?? "").trim();
  if (!message?.guild || !text || text.length < 2) return false;
  if (translationGate({ messageId: message.id, language: target.language, userId: user.id, now })) return false;
  let translated;
  try {
    translated = await translate(text, target.language, anthropic === undefined ? {} : { anthropic });
  } catch {
    done.delete(`${message.id}:${target.language}`); // un autre membre pourra réessayer
    return false;
  }
  await message.reply({ content: `${reaction.emoji.name} **Traduction** (demandée par <@${user.id}>) :\n${translated}`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  return true;
}
