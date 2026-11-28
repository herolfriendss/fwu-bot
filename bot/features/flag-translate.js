// FWU — traduction par drapeau via la passerelle IA centrale.
import { recordAiUsage } from "../ai-usage.js";

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

/** Translate through the FWU server gateway; provider credentials never reach the bot. */
export async function translate(text, language, {
  apiUrl,
  secret,
  guildId,
  userId,
  fetchImpl = fetch,
} = {}) {
  if (!String(apiUrl ?? "").trim() || !String(secret ?? "").trim()) {
    throw new Error("Passerelle IA non configurée.");
  }
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ai-translate",
        guildId,
        userId,
        language: String(language).slice(0, 40),
        text: String(text).slice(0, TRANSLATE.maxChars),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Service IA inaccessible.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error("Limite de traduction atteinte.");
    if (response.status === 503) throw new Error("Fournisseur IA indisponible.");
    if (response.status === 402) throw new Error("Budget IA épuisé.");
    throw new Error("Traduction indisponible.");
  }
  const out = String(payload?.translation ?? "").trim();
  if (!out) throw new Error("traduction refusée");
  recordAiUsage("traduction");
  return out.slice(0, 1_900);
}

/** messageReactionAdd. Rend true si une traduction a été postée. */
export async function handleFlagReaction(reaction, user, { env = process.env, apiUrl, secret, fetchImpl = fetch, now = Date.now() } = {}) {
  if (String(env.PND_FLAG_TRANSLATE ?? "").toLowerCase() === "off" || user?.bot) return false;
  const target = flagLanguage(reaction?.emoji?.name);
  if (!target) return false;
  const message = reaction.message?.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  const text = String(message?.content ?? "").trim();
  if (!message?.guild || !text || text.length < 2) return false;
  if (translationGate({ messageId: message.id, language: target.language, userId: user.id, now })) return false;
  let translated;
  try {
    translated = await translate(text, target.language, { apiUrl, secret, guildId: message.guild.id, userId: user.id, fetchImpl });
  } catch {
    done.delete(`${message.id}:${target.language}`); // un autre membre pourra réessayer
    return false;
  }
  await message.reply({ content: `${reaction.emoji.name} **Traduction** (demandée par <@${user.id}>) :\n${translated}`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  return true;
}
