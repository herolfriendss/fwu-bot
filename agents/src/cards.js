import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";

/** Cartes Discord : propositions avec boutons, résumé quotidien. */

const PRIORITY_COLOR = { haute: 0xe74c3c, moyenne: 0xf39c12, basse: 0x95a5a6 };
const KIND_LABEL = { fonctionnalite: "💡 Nouvelle fonctionnalité", correctif: "🔧 Correctif" };
const STATUS_LABEL = {
  en_attente: "En attente de ta décision",
  validee: "✅ Validée",
  refusee: "❌ Refusée",
  plus_tard: "⏳ Plus tard",
};

export const BUTTON_PREFIX = "agents";
const ACTIONS = { valider: "validee", refuser: "refusee", plustard: "plus_tard" };

export function cut(text, max) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const VERDICT_LABEL = { garder: "👍 à garder", revoir: "✏️ à revoir", abandonner: "👎 à abandonner" };

/** Champ « Avocat du diable » d'une carte. */
export function devilField(d) {
  const a = d.avocat;
  if (!a) return { name: "😈 Avocat du diable", value: `Pas de relecture (${d.avocat_note ?? "indisponible"}).` };
  return {
    name: `😈 Avocat du diable : ${VERDICT_LABEL[a.verdict] ?? a.verdict}`,
    value: cut(`**Objections** : ${a.objections}\n**Risques** : ${a.risques}\n**À te demander** : ${a.question_cle}`, 1024),
  };
}

export function proposalEmbed(p) {
  const d = p.details;
  const embed = new EmbedBuilder()
    .setTitle(cut(`#${p.id} · ${p.title}`, 256))
    .setColor(PRIORITY_COLOR[d.priorite] ?? 0x5865f2)
    .setDescription(cut(d.description, 3500))
    .addFields(
      { name: "Type", value: KIND_LABEL[p.kind] ?? p.kind, inline: true },
      { name: "Concerne", value: d.bot_concerne ?? "serveur", inline: true },
      { name: "Priorité · effort", value: `${d.priorite} · ${d.effort}`, inline: true },
      { name: "Pourquoi", value: cut(d.pourquoi, 1000) || "—" },
      devilField(d),
      { name: "Statut", value: STATUS_LABEL[p.status] ?? p.status },
    )
    .setFooter({ text: `Proposé par l'${p.agent}` });
  if (p.issue_url) embed.addFields({ name: "Ticket GitHub", value: p.issue_url });
  return embed;
}

export function proposalButtons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:valider:${id}`).setLabel("Valider").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:refuser:${id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:plustard:${id}`).setLabel("Plus tard").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

/** Lit l'identifiant d'un bouton. Renvoie null s'il ne vient pas de nous. */
export function parseButton(customId) {
  const m = /^agents:(valider|refuser|plustard):(\d{1,12})$/.exec(String(customId ?? ""));
  if (!m) return null;
  return { status: ACTIONS[m[1]], id: Number(m[2]) };
}

export function digestEmbed({ resume, created, skipped, spentUsd, budgetUsd, pending, purged }) {
  return new EmbedBuilder()
    .setTitle("📋 Résumé du jour : Superviseur")
    .setColor(0x5865f2)
    .setDescription(cut(resume || "Pas de résumé aujourd'hui.", 3500))
    .addFields(
      { name: "Nouvelles propositions", value: String(created), inline: true },
      { name: "Doublons ignorés", value: String(skipped), inline: true },
      { name: "En attente de ta décision", value: String(pending), inline: true },
      { name: "Budget IA du mois", value: `${spentUsd.toFixed(2)} $ / ${budgetUsd.toFixed(2)} $`, inline: true },
      { name: "Extraits effacés (plus de 7 jours)", value: String(purged), inline: true },
    )
    .setTimestamp(new Date());
}
