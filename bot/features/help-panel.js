// Panneau d'aide (/aide, +aide, ;aide, =aide, -aide, $aide) : un menu pour choisir un bot,
// la liste de ses commandes avec le bon préfixe (pages de 20), et une page « Permissions »
// qui explique les paliers, les quotas (tempmute compris), SYS+ et où trouver le détail.
// Le contenu est calculé depuis le catalogue et les profils : il suit les déplacements de commandes.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import { TIER_LABELS, MODERATION_TIERS } from "../shared/tiers.js";
import { QUOTA_COMMANDS, formatDurationFr } from "../shared/quotas.js";

export const HELP_PREFIX = "aide:";
export const HELP_PAGE_SIZE = 20;
const SHARED = new Set(["aide", "status"]);
const BOT_EMOJI = Object.freeze({ fwu: "🛡️", guard: "🚨", fdpdlavoc: "🎧", suckme: "✨", fisc: "💰", investplus: "📈" });

/** Quotas par défaut (migration 001), affichés si la base partagée n'en donne pas d'autres. */
export const DEFAULT_QUOTAS = Object.freeze({
  tempmute: { 50: [2, 1800], 10: [4, 1800], 5: [8, 1800], 1: [15, 1800] },
  warn: { 50: [3, 1800], 10: [6, 1800], 5: [12, 1800], 1: [20, 1800] },
  unmute: { 50: [4, 1800], 10: [8, 1800], 5: [16, 1800], 1: [30, 1800] },
  kick: { 50: [1, 86400], 10: [2, 86400], 5: [4, 86400], 1: [8, 86400] },
  ban: { 50: [0, 86400], 10: [1, 86400], 5: [2, 86400], 1: [4, 86400] },
  unban: { 50: [0, 86400], 10: [1, 86400], 5: [2, 86400], 1: [4, 86400] },
  blacklist: { 50: [0, 86400], 10: [0, 86400], 5: [1, 86400], 1: [4, 86400] },
  mv: { 50: [5, 600], 10: [10, 600], 5: [20, 600], 1: [40, 600] },
});

const PERMISSION_LABELS = Object.freeze({ 32: "Gérer le serveur", 8192: "Gérer les messages", 16: "Gérer les salons", 2: "Expulser", 4: "Bannir", 1099511627776: "Modérer les membres" });

/** Commandes de chaque bot, triées : [{ name, description, permission, quota }]. */
export function commandsByBot(catalog, ownerOf) {
  const out = {};
  for (const command of catalog) {
    if (SHARED.has(command.name)) continue;
    const owner = ownerOf(command.name);
    if (!owner) continue;
    (out[owner] ??= []).push({
      name: command.name,
      description: String(command.description ?? ""),
      permission: PERMISSION_LABELS[command.defaultMemberPermissions] ?? null,
      quota: QUOTA_COMMANDS.includes(command.name),
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return out;
}

const invocation = (name, botId, prefixes) => (botId === "fwu" || !prefixes[botId] ? `/${name}` : `${prefixes[botId]}${name}`);

function line(command, botId, prefixes) {
  const tags = [command.quota ? "⏳" : "", command.permission ? "🔒" : ""].filter(Boolean).join("");
  const description = command.description.length > 80 ? `${command.description.slice(0, 79)}…` : command.description;
  return `\`${invocation(command.name, botId, prefixes)}\`${tags ? ` ${tags}` : ""} ${description}`;
}

/** Page d'accueil : un bloc par bot (préfixe, rôle, nombre de commandes). */
export function overviewEmbed({ profiles, prefixes, commands }) {
  const fields = Object.values(profiles).map((profile) => ({
    name: `${BOT_EMOJI[profile.id] ?? "🤖"} ${profile.label} · ${prefixes[profile.id] ? `préfixe \`${prefixes[profile.id]}\` ou /` : "commandes /"}`,
    value: `${profile.summary}\n${(commands[profile.id] ?? []).length} commande(s)`.slice(0, 1024),
  }));
  return {
    title: "📖 Aide · toutes les commandes",
    description: "Choisis un bot dans le menu pour voir ses commandes, ou **Permissions** pour savoir qui peut faire quoi.\nChaque commande existe sur **un seul** bot : avec son préfixe, ou en / partout.",
    fields: fields.slice(0, 25),
    footer: { text: "⏳ commande à quota · 🔒 permission Discord requise" },
  };
}

/** Page des commandes d'un bot. */
export function botPageEmbed({ botId, page = 0, profiles, prefixes, commands }) {
  const list = commands[botId] ?? [];
  const pages = Math.max(1, Math.ceil(list.length / HELP_PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(current * HELP_PAGE_SIZE, (current + 1) * HELP_PAGE_SIZE);
  const profile = profiles[botId];
  return {
    embed: {
      title: `${BOT_EMOJI[botId] ?? "🤖"} ${profile?.label ?? botId}${pages > 1 ? ` · page ${current + 1}/${pages}` : ""}`,
      description: (slice.length ? slice.map((c) => line(c, botId, prefixes)).join("\n") : "Aucune commande.").slice(0, 4096),
      footer: { text: `${prefixes[botId] ? `Préfixe ${prefixes[botId]} ou /` : "Slash uniquement"} · ⏳ quota · 🔒 permission Discord` },
    },
    page: current,
    pages,
  };
}

/** Page « Permissions » : paliers, quotas (tempmute en tête), SYS+, liens vers le guide. */
export function permissionsEmbed({ prefixes, quotas = DEFAULT_QUOTAS }) {
  const tiers = MODERATION_TIERS.map((tier) => {
    const parts = ["tempmute", "warn", "kick", "ban"].map((command) => {
      const [max, window] = quotas[command]?.[tier] ?? [0, 0];
      return max ? `${command} ${max}/${formatDurationFr(window)}` : `${command} ⛔`;
    });
    return `**${TIER_LABELS[tier]}** : ${parts.join(" · ")}`;
  });
  const suck = prefixes.suckme ?? "/";
  return {
    title: "🔐 Permissions · qui peut faire quoi",
    description: [
      "**Paliers** : chaque rôle staff reçoit un palier (`/quota palier`). Plus il est petit, plus il a de droits. Le nom du rôle ne donne jamais de droit.",
      `**${TIER_LABELS[0]}** : aucune limite.`,
      ...tiers,
      "",
      "**Tempmute** : `/tempmute membre sanction` applique une sanction prédéfinie (durées réglées par les admins avec `/sanctions`). Il faut le palier 50 % au moins, et chaque palier a son quota par 30 min, partagé entre tous les bots.",
      "**Quotas** : les commandes ⏳ (tempmute, warn, unmute, kick, ban, unban, blacklist, mv) sont comptées pour tous les bots ensemble. `/quota moi` montre ce qu'il te reste.",
      "**SYS+** : gestion des rôles et du système, réservée aux membres SYS+ (`/sysp permissions` pour le détail). Le gel du staff par l'owner suspend toutes les commandes ⏳.",
      "**🔒 Permission Discord** : certaines commandes demandent en plus Gérer le serveur, Gérer les salons ou Gérer les messages.",
      "",
      `Guide complet des droits : \`${suck}guide\` · pourquoi une commande t'est refusée : \`${suck}pourquoi commande\`.`,
    ].join("\n").slice(0, 4096),
  };
}

/** Message complet : embed + menu (+ boutons de page). */
export function helpPayload(view, ctx) {
  const { profiles } = ctx;
  let embed;
  let nav = null;
  if (view.section === "permissions") embed = permissionsEmbed(ctx);
  else if (profiles[view.section]) {
    const result = botPageEmbed({ ...ctx, botId: view.section, page: view.page ?? 0 });
    embed = result.embed;
    if (result.pages > 1) {
      nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${HELP_PREFIX}${view.section}:${result.page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(result.page === 0),
        new ButtonBuilder().setCustomId(`${HELP_PREFIX}${view.section}:${result.page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(result.page >= result.pages - 1),
      );
    }
  } else embed = overviewEmbed(ctx);
  const select = new StringSelectMenuBuilder().setCustomId(`${HELP_PREFIX}menu`).setPlaceholder("Choisis un bot ou une rubrique").addOptions(
    { label: "Vue d'ensemble", value: "accueil", emoji: "📖", default: !profiles[view.section] && view.section !== "permissions" },
    ...Object.values(profiles).map((profile) => ({ label: profile.label.slice(0, 100), value: profile.id, emoji: BOT_EMOJI[profile.id] ?? "🤖", description: profile.summary.slice(0, 100), default: view.section === profile.id })),
    { label: "Permissions et quotas", value: "permissions", emoji: "🔐", default: view.section === "permissions" },
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), ...(nav ? [nav] : [])], allowedMentions: { parse: [] } };
}

/** Lit la vue demandée par un composant du panneau ; null si ce n'est pas le nôtre. */
export function helpViewFromInteraction(interaction) {
  const id = String(interaction?.customId ?? "");
  if (!id.startsWith(HELP_PREFIX)) return null;
  if (id === `${HELP_PREFIX}menu`) return { section: interaction.values?.[0] ?? "accueil", page: 0 };
  const [, section, page] = id.split(":");
  return { section, page: Number(page) || 0 };
}

/** Composant du panneau (menu ou page) : met le message à jour sur place. */
export async function handleHelpComponent(interaction, ctx) {
  const view = helpViewFromInteraction(interaction);
  if (!view) return false;
  await interaction.update(helpPayload(view, ctx)).catch(() => {});
  return true;
}
