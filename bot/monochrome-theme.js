// FWU V2 — thème noir et blanc des 6 bots (demande de l'owner du 26/11/2026).
//
// Un seul crochet sur MessagePayload.resolveBody (discord.js) : tout message sortant
// (réponses, envois en salon, éditions, webhooks, panneaux) y passe. Les couleurs
// d'embed deviennent des gris (luminance conservée, pour garder un contraste lisible) et
// les boutons colorés (bleu, vert, rouge) deviennent gris. Les boutons-liens restent des
// liens ; les menus n'ont pas de couleur dans Discord. Les images (bannières, cartes)
// ne sont pas modifiées.
import { MessagePayload } from "discord.js";

/** Palette du thème : du blanc au noir (0 est réservé par Discord à « sans couleur »). */
export const MONO = Object.freeze({
  white: 0xffffff,
  light: 0xd4d4d4,
  mid: 0x8a8a8a,
  dark: 0x3a3a3a,
  black: 0x0b0b0b,
  default: 0xf0f0f0,
});

export function isGray(color) {
  if (!Number.isInteger(color)) return false;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return r === g && g === b;
}

/** Couleur → gris de même luminance (jamais 0). */
export function toMonochrome(color) {
  if (color === null || color === undefined) return color;
  const value = Number(color);
  if (!Number.isFinite(value)) return MONO.default;
  if (isGray(value)) return value === 0 ? MONO.black : value;
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const y = Math.max(0x0b, Math.min(0xff, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
  return (y << 16) | (y << 8) | y;
}

const COLORED_BUTTONS = new Set([1, 3, 4]); // Primary, Success, Danger → Secondary (2)

function themeComponents(components) {
  for (const component of components ?? []) {
    if (!component || typeof component !== "object") continue;
    if (component.type === 2 && COLORED_BUTTONS.has(component.style)) component.style = 2;
    if (Array.isArray(component.components)) themeComponents(component.components);
    if (component.accessory) themeComponents([component.accessory]);
    if (component.type === 17 && component.accent_color !== undefined) component.accent_color = toMonochrome(component.accent_color);
  }
}

/** Applique le thème à un corps de message JSON (en place). */
export function monochromeBody(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body.embeds)) {
    for (const embed of body.embeds) {
      if (!embed || typeof embed !== "object") continue;
      // Exception voulue : l'aperçu d'une couleur de rôle perso montre la vraie couleur.
      if (embed.author?.name === "Aperçu de couleur") continue;
      embed.color = embed.color === undefined || embed.color === null ? MONO.default : toMonochrome(embed.color);
    }
  }
  if (Array.isArray(body.components)) themeComponents(body.components);
  return body;
}

let installed = false;
/** Installe le thème une fois pour tout le processus. */
export function installMonochromeTheme() {
  if (installed) return;
  installed = true;
  const original = MessagePayload.prototype.resolveBody;
  MessagePayload.prototype.resolveBody = function themedResolveBody(...args) {
    const already = Boolean(this.body);
    const result = original.apply(this, args);
    if (!already) {
      try { monochromeBody(this.body); } catch { /* le thème ne bloque jamais un envoi */ }
    }
    return result;
  };
}
