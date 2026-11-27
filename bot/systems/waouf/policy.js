export const MAX_WAOUF_DURATION_MINUTES = 1_440;
export const MAX_WAOUF_PHRASES = 20;
export const DEFAULT_WAOUF_PHRASES = Object.freeze([
  "Wouaf ! {membre}, tu es mon maître !",
  "Wouf ! Le salon est sous surveillance canine.",
]);

export function parseWaoufDuration(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_WAOUF_DURATION_MINUTES) {
    throw new Error("La durée WAOUF doit être comprise entre 1 et 1 440 minutes.");
  }
  return minutes;
}

export function sanitizeWaoufPhrase(value) {
  const phrase = String(value ?? "")
    .trim()
    .slice(0, 180);
  if (!phrase || /@[\u200b\s]*(?:everyone|here)/i.test(phrase)) {
    throw new Error("La phrase doit contenir du texte et ne peut pas viser @everyone ou @here.");
  }
  return phrase;
}

export function isWaoufExpired(expiresAt, now = Date.now()) {
  return Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0 && Number(expiresAt) <= now;
}

export function waoufResponse(deletedCount, repeatAfter, phrases, memberId) {
  if (deletedCount < repeatAfter) return "Wouaf !";
  const choices = Array.isArray(phrases) && phrases.length ? phrases : DEFAULT_WAOUF_PHRASES;
  const offset = Math.max(0, deletedCount - repeatAfter) % choices.length;
  return choices[offset].replaceAll("{membre}", `<@${memberId}>`);
}

// Random barks: each message of a WAOUF member gets a different answer.
const BARKS = Object.freeze(["Wouaf", "Ouaf", "Wouf", "Waf", "Arf", "Ouah", "Wif", "Grrr… wouaf", "Kaï kaï", "Wouaf wouaf"]);
const BARK_ENDS = Object.freeze([" !", " !!", " !!!", " ?!", "…"]);
const BARK_EMOJIS = Object.freeze(["", "", " 🐶", " 🐕", " 🦴", " 🐾"]);
const DOG_ACTIONS = Object.freeze([
  "*remue la queue*", "*fait le beau*", "*réclame un os*", "*se roule par terre*", "*court après sa queue*",
  "*aboie sur le facteur*", "*donne la patte*", "*renifle partout*", "*fait les yeux doux*", "*creuse un trou dans le salon*",
  "*mâchouille un chausson*", "*hurle à la lune*",
]);
const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

/** A freshly generated bark, e.g. "Wouuuaf !! 🐾" or "*donne la patte*". */
export function generateBark(random = Math.random) {
  if (random() < 0.25) return pick(DOG_ACTIONS, random);
  const stretched = pick(BARKS, random).replace(/[ou]/, (vowel) => vowel.repeat(1 + Math.floor(random() * 4)));
  return `${stretched}${pick(BARK_ENDS, random)}${pick(BARK_EMOJIS, random)}`;
}

/**
 * The answer to one WAOUF message: a generated bark most of the time, sometimes one of the
 * configured phrases, never the same text twice in a row for this member.
 */
export function randomWaoufResponse({ phrases, memberId, previous = null, random = Math.random } = {}) {
  const choices = Array.isArray(phrases) && phrases.length ? phrases : DEFAULT_WAOUF_PHRASES;
  let response = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    response = random() < 0.3
      ? pick(choices, random).replaceAll("{membre}", `<@${memberId}>`)
      : generateBark(random);
    if (response !== previous) break;
  }
  return response;
}

/** Prefix every automated WAOUF response with the real author display name. */
export function formatWaoufAnnouncement(displayName, response) {
  const author = String(displayName ?? "Membre")
    .replace(/[@`*_~|>]/g, "\\$&")
    .trim()
    .slice(0, 80) || "Membre";
  return `**${author}** : ${String(response ?? "Wouaf !")}`;
}
