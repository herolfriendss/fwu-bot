// FWU V2 — choix de couleur des rôles perso sans taper de code : 25 couleurs nommées avec
// aperçu en direct, plus une couleur libre #RRGGBB pour les précis. Le rôle reste à zéro
// permission ; le quota ne change pas.

export const NAMED_COLORS = Object.freeze([
  ["Rouge", "#E53935"], ["Cerise", "#C2185B"], ["Rose", "#FF66CC"], ["Rose pâle", "#F8BBD0"], ["Framboise", "#D81B60"],
  ["Orange", "#FB8C00"], ["Corail", "#FF7F50"], ["Pêche", "#FFB38A"], ["Or", "#FFC107"], ["Jaune", "#FFEB3B"],
  ["Citron vert", "#C0CA33"], ["Vert", "#43A047"], ["Menthe", "#66E0A3"], ["Émeraude", "#00A86B"], ["Sapin", "#1B5E20"],
  ["Turquoise", "#1DE9B6"], ["Cyan", "#00BCD4"], ["Bleu ciel", "#64B5F6"], ["Bleu", "#1E88E5"], ["Marine", "#1A237E"],
  ["Lavande", "#B39DDB"], ["Violet", "#8E24AA"], ["Prune", "#6A1B9A"], ["Blanc", "#FFFFFF"], ["Gris", "#9E9E9E"],
].map(([name, hex]) => Object.freeze({ name, hex })));

const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Nom de couleur (« rose pâle ») ou #RRGGBB → #RRGGBB ; null si illisible. */
export function resolveColor(value) {
  const text = String(value ?? "").trim();
  if (/^#?[\da-f]{6}$/i.test(text)) return `#${text.replace("#", "").toUpperCase()}`;
  const found = NAMED_COLORS.find((color) => normalize(color.name) === normalize(text));
  return found ? found.hex : null;
}

export function colorName(hex) {
  return NAMED_COLORS.find((color) => color.hex === String(hex).toUpperCase())?.name ?? String(hex).toUpperCase();
}

/** Aperçu : l'embed porte la vraie couleur (exempté du thème noir et blanc, voir monochrome-theme.js). */
export const COLOR_PREVIEW_AUTHOR = "Aperçu de couleur";
export function colorPreviewEmbed(hex, roleName = null) {
  return {
    author: { name: COLOR_PREVIEW_AUTHOR },
    color: Number.parseInt(hex.slice(1), 16),
    title: `🎨 ${colorName(hex)} (${hex})`,
    description: `${roleName ? `Rôle : **${roleName}**\n` : ""}La barre à gauche montre la couleur. Clique sur « Appliquer » pour la garder.`,
  };
}

/** Menu des 25 couleurs + bouton « Couleur libre ». `base` = préfixe des identifiants. */
export function colorPickerComponents(base, { selected = null } = {}) {
  const rows = [{
    type: 1,
    components: [{
      type: 3, custom_id: `${base}:pick`, placeholder: "Choisis une couleur",
      options: NAMED_COLORS.map((color) => ({ label: color.name, value: color.hex, description: color.hex, default: color.hex === selected })),
    }],
  }];
  const buttons = [{ type: 2, style: 2, label: "Couleur libre (#RRGGBB)", custom_id: `${base}:free` }];
  if (selected) buttons.unshift({ type: 2, style: 3, label: "Appliquer", custom_id: `${base}:apply:${selected.slice(1)}` });
  rows.push({ type: 1, components: buttons });
  return rows;
}
