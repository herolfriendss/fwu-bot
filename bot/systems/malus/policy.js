// MALUS : punitions temporaires et réversibles posées par un SYS+ (perroquet, fantôme, mime…).
// Ce fichier est pur (aucun appel Discord) : transformations de texte, limites, durées.

export const MESSAGE_KINDS = Object.freeze(["perroquet", "fantome", "mime", "clown", "robot", "bebe", "yoda", "chuchote", "sablier", "malediction"]);
export const VOICE_KINDS = Object.freeze(["sourdine-folle", "exil"]);
export const ROLE_KINDS = Object.freeze(["bouffon"]);
export const ECONOMY_KINDS = Object.freeze(["taxe", "rancon", "cible"]);
export const ALL_KINDS = Object.freeze([...MESSAGE_KINDS, ...VOICE_KINDS, ...ROLE_KINDS, ...ECONOMY_KINDS]);
/** Kinds whose message is deleted and reposted transformed (only one applies per message). */
export const REWRITE_KINDS = Object.freeze(["perroquet", "robot", "bebe", "yoda", "chuchote"]);

export const KIND_LABELS = Object.freeze({
  perroquet: "🦜 Perroquet", fantome: "👻 Fantôme", mime: "🤐 Mime", clown: "🤡 Clown", robot: "🤖 Robot", bebe: "👶 Bébé",
  yoda: "🟢 Yoda", chuchote: "🤫 Chuchote", sablier: "⏳ Sablier", malediction: "🧿 Malédiction",
  "sourdine-folle": "🎙️ Sourdine folle", exil: "🏝️ Exil", bouffon: "🃏 Bouffon", taxe: "💸 Taxe", rancon: "🔒 Rançon", cible: "🎯 Cible",
});

export const DEFAULT_MINUTES = 10;
export const MAX_MINUTES = 60;
export const MAX_ACTIVE_PER_ACTOR = 5;
export const SABLIER_MS = 60_000;
export const FANTOME_MS = 5_000;
export const MALEDICTION_CHANCE = 0.2;

export function parseMinutes(value, { fallback = DEFAULT_MINUTES, max = MAX_MINUTES } = {}) {
  if (value === null || value === undefined) return fallback;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > max) throw new Error(`La durée doit être comprise entre 1 et ${max} minutes.`);
  return minutes;
}

/** Can this actor start one more malus? owner/WHITELIST are not exempt: the limit is per SYS+. */
export function canStartMalus(activeCountForActor, max = MAX_ACTIVE_PER_ACTOR) {
  return activeCountForActor < max;
}

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

export function mockCase(text) {
  let upper = false;
  return [...text].map((ch) => {
    if (ch.toLowerCase() === ch.toUpperCase()) return ch;
    upper = !upper;
    return upper ? ch.toLowerCase() : ch.toUpperCase();
  }).join("");
}

export function perroquet(text, random = Math.random) {
  const mode = Math.floor(random() * 3);
  if (mode === 0) return mockCase(text);
  if (mode === 1) return [...text].reverse().join("");
  return `${text.toUpperCase()} !!!`;
}

const BIPS = ["BIP", "BOUP", "BZZT", "BIP BOUP", "*bruit de modem*", "ERREUR 404"];
export function robot(text, random = Math.random) {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean).slice(0, 60);
  const out = [];
  for (const word of words) { out.push(word); if (random() < 0.3) out.push(pick(BIPS, random)); }
  return `🤖 ${pick(BIPS, random)}. ${out.join(". ")}. ${pick(BIPS, random)}.`;
}

export function bebe(text, random = Math.random) {
  const baby = text
    .replace(/ch/gi, (m) => (m[0] === "C" ? "SS" : "ss"))
    .replace(/r/g, "w").replace(/R/g, "W")
    .replace(/j/g, "z").replace(/J/g, "Z");
  return `${baby} ${pick(["👶", "gouzi gouzi 👶", "*suce son pouce*", "areuh 🍼", "*fait un rot*"], random)}`;
}

export function yoda(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) return `${text}, hmm.`;
  const cut = Math.ceil(words.length / 2);
  return `${words.slice(cut).join(" ")}, ${words.slice(0, cut).join(" ")}, hmm.`;
}

const SMALL = { a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ᶦ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", q: "ᑫ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  à: "ᵃ", â: "ᵃ", é: "ᵉ", è: "ᵉ", ê: "ᵉ", ë: "ᵉ", î: "ᶦ", ï: "ᶦ", ô: "ᵒ", ù: "ᵘ", û: "ᵘ", ç: "ᶜ",
  0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
export function chuchote(text) {
  return [...text.toLowerCase()].map((ch) => SMALL[ch] ?? ch).join("");
}

export const MALEDICTION_PHRASES = Object.freeze([
  "J'adore les SYS+, ce sont mes idoles ❤️", "Je dors encore avec un doudou 🧸", "J'ai peur du noir, quelqu'un peut laisser la lumière ?",
  "Ma maman m'appelle « mon petit lapin » 🐰", "Je perds à tous les jeux, même au morpion", "Je parle à mes plantes tous les soirs 🌱",
  "J'ai pleuré devant un dessin animé hier", "Le SYS+ a toujours raison, je le jure", "Je mets du ketchup sur mes pâtes ET sur ma pizza",
  "J'ai déjà perdu un duel contre un pigeon 🐦", "Je chante sous la douche, faux", "Je suis le plus grand fan du bot 🤖",
]);

/** Rewrites a message for the first rewrite kind in `kinds` (or null when nothing applies). */
export function rewriteFor(kinds, text, random = Math.random) {
  const kind = REWRITE_KINDS.find((k) => kinds.includes(k));
  if (!kind || !String(text ?? "").trim()) return null;
  const input = String(text).slice(0, 1500);
  const fn = { perroquet, robot, bebe, yoda, chuchote }[kind];
  return { kind, text: fn(input, random).slice(0, 1800) };
}

const EMOJI_ONLY = /^(?:\s|<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|[#*0-9]️?⃣)+$/u;
export function isEmojiOnly(text) {
  return EMOJI_ONLY.test(String(text ?? ""));
}

/** Escapes a display name before it signs a reposted message. */
export function signature(displayName) {
  return String(displayName ?? "Membre").replace(/[@`*_~|>\\]/g, "\\$&").trim().slice(0, 80) || "Membre";
}

/** Decides what happens to one message of a member under these malus. Pure. */
export function decideMessage({ kinds, text, hasAttachments = false, lastSablierAt = 0, now = Date.now(), random = Math.random }) {
  const actions = { remove: false, repost: null, react: null, removeAfterMs: null, sablierStamp: false, kind: null };
  if (kinds.includes("mime") && (!isEmojiOnly(text) || hasAttachments)) return { ...actions, remove: true, kind: "mime" };
  if (kinds.includes("sablier")) {
    if (now - lastSablierAt < SABLIER_MS) return { ...actions, remove: true, kind: "sablier" };
    actions.sablierStamp = true;
  }
  if (kinds.includes("malediction") && random() < MALEDICTION_CHANCE) {
    actions.remove = true; actions.repost = pick(MALEDICTION_PHRASES, random); actions.kind = "malediction";
  } else {
    const rewritten = rewriteFor(kinds, text, random);
    if (rewritten) { actions.remove = true; actions.repost = rewritten.text; actions.kind = rewritten.kind; }
  }
  // Clown and fantôme apply to whatever stays visible: the original or its reposted version.
  if (kinds.includes("clown")) { actions.react = "🤡"; actions.kind ??= "clown"; }
  if (kinds.includes("fantome")) { actions.removeAfterMs = FANTOME_MS; actions.kind ??= "fantome"; }
  return actions;
}
