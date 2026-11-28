// FWU — embeds, règlement généré par l'IA et écran d'adhésion.
//   /embed creer|modifier|champ|champ-retirer|image|apercu|publier|importer|liste|supprimer
//   /reglement generer|apercu|publier      /screening configurer|synchroniser|etat
// Réservé aux admins (palier 5 % ou plus haut). Tout est stocké dans la base
// centrale ; le règlement n'est publié qu'après validation par un admin.
import { applyBanner } from "./banners.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from "discord.js";
import { roleGrantRefusal } from "./role-grant-guard.js";
import { SharedDbUnavailableError, isConnectionError, sharedQuery } from "./shared/db.js";
import { logCommandUsage } from "./shared/audit.js";
import { memberTier } from "./shared/tiers.js";
import { generateRules, parseRulesText, rulesToEmbedPages, rulesToText, validateRules } from "./rules-ai.js";

export const EMBED_COMMANDS = new Set(["embed", "reglement", "screening"]);
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const UNAVAILABLE = "🛑 La base centrale est injoignable : réessaie dans un instant.";
const DENIED = "⛔ Réservé aux admins (palier 5 % ou plus haut).";
const ACCEPT_ID = "screening:accept";

// ── Données d'un embed ─────────────────────────────────────────────────────

export function parseColor(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  const hex = /^#?([0-9a-f]{6})$/i.exec(text);
  if (!hex) throw new Error("Couleur invalide : format #RRGGBB (ex. #6D28D9).");
  return parseInt(hex[1], 16);
}

export function checkUrl(input, label) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label} : URL invalide.`); }
  if (url.protocol !== "https:") throw new Error(`${label} : seules les adresses HTTPS sont acceptées.`);
  return url.toString().slice(0, 500);
}

/** Validate an embed against Discord's limits. Throws a clear error. */
export function validateEmbedData(data) {
  const out = {
    title: String(data.title ?? "").trim().slice(0, 256) || null,
    description: String(data.description ?? "").trim() || null,
    color: data.color ?? null,
    image: data.image ?? null,
    thumbnail: data.thumbnail ?? null,
    footer: String(data.footer ?? "").trim() || null,
    fields: Array.isArray(data.fields) ? data.fields : [],
  };
  if (out.description && out.description.length > 4096) throw new Error("Description trop longue (4 096 caractères maximum).");
  if (out.footer && out.footer.length > 2048) throw new Error("Pied de page trop long (2 048 caractères maximum).");
  if (out.fields.length > 25) throw new Error("25 champs maximum.");
  for (const field of out.fields) {
    if (!field.name || field.name.length > 256 || !field.value || field.value.length > 1024) throw new Error("Champ invalide (titre ≤ 256, valeur ≤ 1 024 caractères).");
  }
  if (!out.title && !out.description && !out.fields.length && !out.image) throw new Error("L'embed est vide : ajoute au moins un titre, une description, un champ ou une image.");
  const total = (out.title?.length ?? 0) + (out.description?.length ?? 0) + (out.footer?.length ?? 0)
    + out.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  if (total > 6000) throw new Error("L'embed dépasse 6 000 caractères au total (limite Discord).");
  return out;
}

export function buildEmbed(data) {
  const embed = new EmbedBuilder();
  if (data.title) embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  if (data.color != null) embed.setColor(data.color);
  if (data.image) embed.setImage(data.image);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (data.fields?.length) embed.addFields(data.fields.map((field) => ({ name: field.name, value: field.value, inline: Boolean(field.inline) })));
  return embed;
}

/** Discord embed JSON (an existing message) → our data model. */
export function embedJsonToData(json) {
  return validateEmbedData({
    title: json.title, description: json.description, color: json.color ?? null,
    image: json.image?.url ?? null, thumbnail: json.thumbnail?.url ?? null, footer: json.footer?.text ?? null,
    fields: (json.fields ?? []).map((field) => ({ name: field.name, value: field.value, inline: Boolean(field.inline) })),
  });
}

export function parseMessageLink(link) {
  const match = /discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/.exec(String(link ?? ""));
  return match ? { guildId: match[1], channelId: match[2], messageId: match[3] } : null;
}

// ── Accès base ─────────────────────────────────────────────────────────────

async function getEmbedRow(guildId, name) {
  const { rows } = await sharedQuery("SELECT id, name, data, channel_id, message_id FROM embeds WHERE guild_id = $1 AND name = $2", [guildId, name]);
  return rows[0] ?? null;
}

async function saveEmbed(guildId, name, data, actorId, { create = false } = {}) {
  if (create) {
    try {
      await sharedQuery("INSERT INTO embeds(guild_id, name, data, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)", [guildId, name, JSON.stringify(data), actorId]);
    } catch (error) {
      if (error?.code === "23505") throw new Error(`Un embed « ${name} » existe déjà : utilise \`/embed modifier\`.`);
      throw error;
    }
    return;
  }
  await sharedQuery("UPDATE embeds SET data = $3, updated_by = $4, updated_at = now() WHERE guild_id = $1 AND name = $2", [guildId, name, JSON.stringify(data), actorId]);
}

/** If the embed is already published, update the message in place. */
async function refreshPublished(guild, row, data) {
  if (!row?.channel_id || !row?.message_id) return null;
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (!message) return "introuvable";
  if (message.author?.id !== guild.client.user?.id) return "pas-a-moi";
  await message.edit({ embeds: [buildEmbed(data)] });
  return "ok";
}

// ── Interactions ───────────────────────────────────────────────────────────

async function isAdmin(member) {
  const tier = await memberTier(member);
  return tier === 0 || (tier != null && tier <= 5);
}

async function reply(interaction, content, extra = {}) {
  const payload = { content, ephemeral: true, allowedMentions: { parse: [] }, ...extra };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function embedModal(customId, title, data = {}) {
  const input = (id, label, style, value, max, required = false) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) field.setValue(String(value).slice(0, max));
    return new ActionRowBuilder().addComponents(field);
  };
  return new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45)).addComponents(
    input("title", "Titre", TextInputStyle.Short, data.title, 256),
    input("description", "Description", TextInputStyle.Paragraph, data.description, 4000),
    input("color", "Couleur (#RRGGBB)", TextInputStyle.Short, data.color != null ? `#${data.color.toString(16).padStart(6, "0")}` : "", 7),
    input("image", "Image (URL HTTPS)", TextInputStyle.Short, data.image, 500),
    input("footer", "Pied de page", TextInputStyle.Short, data.footer, 2048),
  );
}

async function handleEmbedCommand(interaction, { bot, audit }) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const actorId = interaction.user.id;
  const name = String(interaction.options.getString("nom") ?? "").trim().toLowerCase();
  if (sub !== "liste" && !NAME.test(name)) return reply(interaction, "❌ Nom invalide : lettres minuscules, chiffres, - et _ (32 caractères max).");

  if (sub === "creer") {
    if (await getEmbedRow(guild.id, name)) return reply(interaction, `❌ Un embed « ${name} » existe déjà : utilise \`/embed modifier\`.`);
    return interaction.showModal(embedModal(`embed:create:${name}`, `Nouvel embed · ${name}`));
  }
  if (sub === "liste") {
    const { rows } = await sharedQuery("SELECT name, channel_id, updated_at FROM embeds WHERE guild_id = $1 ORDER BY name LIMIT 50", [guild.id]);
    return reply(interaction, rows.length ? `🧩 **Embeds**\n${rows.map((row) => `• \`${row.name}\`${row.channel_id ? ` — publié dans <#${row.channel_id}>` : " — non publié"}`).join("\n")}` : "Aucun embed : crée-en un avec `/embed creer`.");
  }
  if (sub === "importer") {
    const link = parseMessageLink(interaction.options.getString("lien", true));
    if (!link || link.guildId !== guild.id) return reply(interaction, "❌ Lien de message invalide (il doit venir de ce serveur).");
    const channel = await guild.channels.fetch(link.channelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(link.messageId).catch(() => null) : null;
    if (!message?.embeds?.length) return reply(interaction, "❌ Message introuvable ou sans embed.");
    if (message.author?.id !== interaction.client.user?.id) return reply(interaction, "❌ Discord ne permet d'éditer que les messages envoyés par ce bot.");
    const data = embedJsonToData(message.embeds[0].toJSON?.() ?? message.embeds[0].data ?? message.embeds[0]);
    await saveEmbed(guild.id, name, data, actorId, { create: true });
    await sharedQuery("UPDATE embeds SET channel_id = $3, message_id = $4 WHERE guild_id = $1 AND name = $2", [guild.id, name, link.channelId, link.messageId]);
    await logCommandUsage({ guildId: guild.id, userId: actorId, bot, command: "embed importer", outcome: "ok", detail: name });
    return reply(interaction, `✅ Embed importé sous le nom \`${name}\` : tu peux maintenant le modifier, il sera mis à jour en place.`);
  }

  const row = await getEmbedRow(guild.id, name);
  if (!row) return reply(interaction, `❌ Aucun embed « ${name} ».`);
  const data = row.data;

  if (sub === "modifier") return interaction.showModal(embedModal(`embed:edit:${name}`, `Modifier · ${name}`, data));
  if (sub === "apercu") return reply(interaction, `Aperçu de \`${name}\` :`, { embeds: [buildEmbed(data)] });
  if (sub === "supprimer") {
    await sharedQuery("DELETE FROM embeds WHERE guild_id = $1 AND name = $2", [guild.id, name]);
    await logCommandUsage({ guildId: guild.id, userId: actorId, bot, command: "embed supprimer", outcome: "ok", detail: name });
    return reply(interaction, `🗑️ Embed \`${name}\` supprimé de la base (le message publié reste en place).`);
  }

  let next = { ...data };
  if (sub === "champ") {
    next.fields = [...(data.fields ?? []), { name: interaction.options.getString("titre", true), value: interaction.options.getString("valeur", true), inline: interaction.options.getBoolean("en_ligne") ?? false }];
  } else if (sub === "champ-retirer") {
    const index = interaction.options.getInteger("numero", true) - 1;
    if (!data.fields?.[index]) return reply(interaction, "❌ Ce champ n'existe pas.");
    next.fields = data.fields.filter((_, i) => i !== index);
  } else if (sub === "image") {
    const image = interaction.options.getString("image");
    const thumbnail = interaction.options.getString("miniature");
    if (image === null && thumbnail === null) return reply(interaction, "ℹ️ Indique une image et/ou une miniature.");
    if (image !== null) next.image = checkUrl(image, "Image");
    if (thumbnail !== null) next.thumbnail = checkUrl(thumbnail, "Miniature");
  } else if (sub === "publier") {
    const target = interaction.options.getChannel("salon") ?? (row.channel_id ? await guild.channels.fetch(row.channel_id).catch(() => null) : null);
    if (!target?.isTextBased?.()) return reply(interaction, "❌ Choisis le salon de publication.");
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (!target.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return reply(interaction, `⛔ Il me faut Voir, Envoyer des messages et Intégrer des liens dans <#${target.id}>.`);
    }
    await interaction.deferReply({ ephemeral: true });
    if (row.channel_id === target.id && row.message_id) {
      const state = await refreshPublished(guild, row, data);
      if (state === "ok") {
        audit(guild, null, "🧩 Embed mis à jour", `Par : <@${actorId}>\nEmbed : \`${name}\`\nSalon : <#${target.id}>`);
        return reply(interaction, `✅ Message existant mis à jour dans <#${target.id}>.`);
      }
    }
    const sent = await target.send({ embeds: [buildEmbed(data)], allowedMentions: { parse: [] } });
    await sharedQuery("UPDATE embeds SET channel_id = $3, message_id = $4, updated_by = $5, updated_at = now() WHERE guild_id = $1 AND name = $2", [guild.id, name, target.id, sent.id, actorId]);
    await logCommandUsage({ guildId: guild.id, userId: actorId, bot, command: "embed publier", outcome: "ok", detail: name });
    audit(guild, null, "🧩 Embed publié", `Par : <@${actorId}>\nEmbed : \`${name}\`\nSalon : <#${target.id}>`);
    return reply(interaction, `✅ Embed publié dans <#${target.id}>.`);
  }
  next = validateEmbedData(next);
  await saveEmbed(guild.id, name, next, actorId);
  const refreshed = await refreshPublished(guild, row, next).catch(() => "erreur");
  return reply(interaction, `✅ Embed \`${name}\` mis à jour${refreshed === "ok" ? " (message publié modifié en place)" : refreshed ? " (le message publié n'a pas pu être modifié)" : ""}.`, { embeds: [buildEmbed(next)] });
}

async function handleEmbedModal(interaction, { bot, audit, ai }) {
  const [, mode, name] = interaction.customId.split(":");
  if (mode === "reglement") return handleRulesModal(interaction, { bot, audit, ai });
  if (!NAME.test(name ?? "")) return reply(interaction, "❌ Nom invalide.");
  const guild = interaction.guild;
  const field = (id) => interaction.fields.getTextInputValue(id) ?? "";
  const row = mode === "edit" ? await getEmbedRow(guild.id, name) : null;
  if (mode === "edit" && !row) return reply(interaction, "❌ Cet embed n'existe plus.");
  const data = validateEmbedData({
    ...(row?.data ?? {}),
    title: field("title"), description: field("description"), color: parseColor(field("color")),
    image: checkUrl(field("image"), "Image"), footer: field("footer"),
  });
  await saveEmbed(guild.id, name, data, interaction.user.id, { create: mode === "create" });
  await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: `embed ${mode === "create" ? "creer" : "modifier"}`, outcome: "ok", detail: name });
  const refreshed = row ? await refreshPublished(guild, row, data).catch(() => "erreur") : null;
  if (refreshed === "ok") audit(guild, null, "🧩 Embed modifié", `Par : <@${interaction.user.id}>\nEmbed : \`${name}\``);
  return reply(interaction, `✅ Embed \`${name}\` ${mode === "create" ? "créé" : "enregistré"}${refreshed === "ok" ? " et mis à jour en place" : ""}. ${mode === "create" ? "Publie-le avec `/embed publier`." : ""}`, { embeds: [buildEmbed(data)] });
}

// ── Règlement ──────────────────────────────────────────────────────────────

function rulesPreview(draft) {
  const pages = rulesToEmbedPages(draft.rules);
  const embeds = pages.slice(0, 9).map((page, index) => new EmbedBuilder().setColor(0xbdbdbd)
    .setTitle(index === 0 ? "📝 Brouillon de règlement — à relire" : `📝 Brouillon — partie ${index + 1}`)
    .setDescription(index === 0 ? `*Rien n'est publié avant ta validation.*\n\n${page}`.slice(0, 4096) : page));
  embeds.at(-1)?.setFooter({ text: `Brouillon #${draft.id} · ${draft.rules.length} règles · statut : ${draft.status}` });
  const buttons = draft.status === "draft" ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rules:approve:${draft.id}`).setLabel("Valider").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rules:regen:${draft.id}`).setLabel("Régénérer").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rules:reject:${draft.id}`).setLabel("Refuser").setEmoji("✖️").setStyle(ButtonStyle.Danger),
  )] : [];
  return { embeds, components: buttons };
}

async function latestDraft(guildId, statuses) {
  const { rows } = await sharedQuery(
    "SELECT id, rules, status, created_by FROM rules_drafts WHERE guild_id = $1 AND status = ANY($2) ORDER BY id DESC LIMIT 1",
    [guildId, statuses],
  );
  return rows[0] ? { ...rows[0], id: String(rows[0].id) } : null;
}

export function buildRulesGatewayInput(guild, actorId, consignes, count, ai = {}) {
  return {
    apiUrl: ai.apiUrl,
    secret: ai.secret,
    guildId: guild.id,
    userId: actorId,
    guildName: guild.name,
    consignes,
    count,
  };
}

async function createDraft(guild, actorId, consignes, count, ai) {
  const rules = await generateRules(buildRulesGatewayInput(guild, actorId, consignes, count, ai));
  const { rows } = await sharedQuery("INSERT INTO rules_drafts(guild_id, rules, created_by) VALUES ($1, $2, $3) RETURNING id", [guild.id, JSON.stringify(rules), actorId]);
  return { id: String(rows[0].id), rules, status: "draft" };
}

async function publishRules(guild, channel, draft, actorId) {
  const pages = rulesToEmbedPages(draft.rules);
  // V2 : règlement embelli (en-tête, icône du serveur, bannière, pied de page clair).
  const icon = guild.iconURL?.({ size: 128 }) ?? null;
  const embeds = pages.slice(0, 10).map((page, index) => {
    const embed = new EmbedBuilder().setColor(0xf0f0f0)
      .setTitle(index === 0 ? `📜 Règlement de ${guild.name}` : `📜 Règlement — partie ${index + 1}`)
      .setDescription(index === 0 ? `*Merci de lire ces règles avant de participer.*\n\n${page}`.slice(0, 4096) : page);
    if (index === 0 && icon) embed.setThumbnail(icon);
    return embed;
  });
  applyBanner(embeds.at(-1), "verification");
  embeds.at(-1)?.setFooter({ text: `${draft.rules.length} règles · en restant sur ce serveur, tu acceptes ce règlement.` }).setTimestamp(new Date());
  // Déjà publié dans ce salon : on met le message à jour (lien et épingle conservés).
  const { rows: previous } = await sharedQuery(
    "SELECT published_message_id FROM rules_drafts WHERE guild_id = $1 AND published_channel_id = $2 AND published_message_id IS NOT NULL ORDER BY id DESC LIMIT 1",
    [guild.id, channel.id],
  ).catch(() => ({ rows: [] }));
  const old = previous[0]?.published_message_id ? await channel.messages?.fetch?.(previous[0].published_message_id).catch(() => null) : null;
  const sent = old?.editable ? await old.edit({ embeds, allowedMentions: { parse: [] } }) : await channel.send({ embeds, allowedMentions: { parse: [] } });
  sent.updatedInPlace = Boolean(old?.editable);
  await sharedQuery(
    "UPDATE rules_drafts SET status = 'published', published_channel_id = $2, published_message_id = $3, reviewed_by = COALESCE(reviewed_by, $4), reviewed_at = COALESCE(reviewed_at, now()) WHERE id = $1",
    [draft.id, channel.id, sent.id, actorId],
  );
  return sent;
}

async function handleReglementCommand(interaction, { bot, audit, ai }) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "generer") {
    await interaction.deferReply({ ephemeral: true });
    const draft = await createDraft(guild, interaction.user.id, interaction.options.getString("consignes") ?? "", interaction.options.getInteger("nombre") ?? 10, ai);
    await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "reglement generer", outcome: "ok", detail: `brouillon ${draft.id}` });
    return interaction.editReply({ content: "Relis le brouillon, puis valide-le, régénère-le ou refuse-le. Rien n'est publié sans validation.", ...rulesPreview(draft), allowedMentions: { parse: [] } });
  }
  if (sub === "ecrire") {
    const current = await latestDraft(guild.id, ["draft", "approved", "published"]).catch(() => null);
    const field = new TextInputBuilder().setCustomId("rules").setLabel("Une règle par ligne : Titre : description")
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)
      .setPlaceholder("Respect : pas d'insulte ni de harcèlement.\nPublicité : interdite sans accord du staff.");
    const text = rulesToText(current?.rules).slice(0, 4000);
    if (text) field.setValue(text);
    return interaction.showModal(new ModalBuilder().setCustomId("embed:reglement").setTitle("Écrire le règlement").addComponents(new ActionRowBuilder().addComponents(field)));
  }
  if (sub === "apercu") {
    const draft = await latestDraft(guild.id, ["draft", "approved", "published"]);
    if (!draft) return reply(interaction, "Aucun brouillon : lance `/reglement generer`.");
    return reply(interaction, draft.status === "draft" ? "Dernier brouillon, en attente de validation :" : `Dernier règlement (${draft.status === "approved" ? "validé, pas encore publié" : "publié"}) :`, rulesPreview(draft));
  }
  if (sub === "publier") {
    const draft = await latestDraft(guild.id, ["approved", "published"]);
    if (!draft) return reply(interaction, "❌ Aucun règlement validé : génère-le puis clique sur « Valider ».");
    const channel = interaction.options.getChannel("salon", true);
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (!channel.permissionsFor?.(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return reply(interaction, `⛔ Il me faut Envoyer des messages et Intégrer des liens dans <#${channel.id}>.`);
    await interaction.deferReply({ ephemeral: true });
    const sent = await publishRules(guild, channel, draft, interaction.user.id);
    await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "reglement publier", outcome: "ok", detail: `brouillon ${draft.id}` });
    audit(guild, null, "📜 Règlement publié", `Par : <@${interaction.user.id}>\nSalon : <#${channel.id}>\nBrouillon : #${draft.id} (${draft.rules.length} règles)`);
    return reply(interaction, `✅ Règlement ${sent.updatedInPlace ? "mis à jour" : "publié"} dans <#${channel.id}>. Pense à \`/screening configurer\` ou \`/screening synchroniser\` pour l'écran d'adhésion.`);
  }
  return reply(interaction, "Sous-commande inconnue.");
}

/** Règlement écrit à la main : validé d'office (c'est l'admin qui l'a rédigé), prêt à publier en embed. */
async function handleRulesModal(interaction, { bot, audit, ai }) {
  const guild = interaction.guild;
  const checked = validateRules(parseRulesText(interaction.fields.getTextInputValue("rules")));
  const blocking = checked.problems.filter((problem) => !problem.includes("doublon"));
  if (blocking.length) return reply(interaction, `❌ Règlement refusé : ${blocking.join(" ; ")}. Il faut de 5 à 20 règles, titre de 80 caractères et description de 400 au plus.`);
  const { rows } = await sharedQuery(
    "INSERT INTO rules_drafts(guild_id, rules, created_by, status, reviewed_by, reviewed_at) VALUES ($1, $2, $3, 'approved', $3, now()) RETURNING id",
    [guild.id, JSON.stringify(checked.rules), interaction.user.id],
  );
  const draft = { id: String(rows[0].id), rules: checked.rules, status: "approved" };
  await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "reglement ecrire", outcome: "ok", detail: `brouillon ${draft.id}` });
  audit(guild, null, "📝 Règlement rédigé", `Par : <@${interaction.user.id}>\nBrouillon : #${draft.id} (${draft.rules.length} règles)`);
  const warn = checked.problems.length ? `\n⚠️ À vérifier : ${checked.problems.join(" ; ")}.` : "";
  return reply(interaction, `✅ Règlement enregistré (${draft.rules.length} règles). Publie-le en embed avec \`/reglement publier salon:#règlement\` : s'il y est déjà, le message est mis à jour.${warn}`, rulesPreview(draft));
}

async function handleRulesButton(interaction, { bot, audit, ai }) {
  const [, action, id] = interaction.customId.split(":");
  const guild = interaction.guild;
  const { rows } = await sharedQuery("SELECT id, rules, status FROM rules_drafts WHERE guild_id = $1 AND id = $2", [guild.id, id]);
  const draft = rows[0] ? { ...rows[0], id: String(rows[0].id) } : null;
  if (!draft || draft.status !== "draft") return interaction.update({ content: "Ce brouillon a déjà été traité.", components: [] });
  if (action === "regen") {
    await interaction.deferUpdate();
    await sharedQuery("UPDATE rules_drafts SET status = 'rejected', reviewed_by = $2, reviewed_at = now() WHERE id = $1", [id, interaction.user.id]);
    const next = await createDraft(guild, interaction.user.id, "", draft.rules.length, ai);
    return interaction.editReply({ content: "🔁 Nouveau brouillon :", ...rulesPreview(next) });
  }
  const status = action === "approve" ? "approved" : "rejected";
  await sharedQuery("UPDATE rules_drafts SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 AND status = 'draft'", [id, status, interaction.user.id]);
  await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: `reglement ${status}`, outcome: "ok", detail: `brouillon ${id}` });
  if (status === "approved") audit(guild, null, "📜 Règlement validé", `Par : <@${interaction.user.id}>\nBrouillon : #${id} (${draft.rules.length} règles)`);
  return interaction.update({
    content: status === "approved" ? `✅ Brouillon #${id} validé. Publie-le avec \`/reglement publier salon:#règlement\`.` : `✖️ Brouillon #${id} refusé.`,
    ...rulesPreview({ ...draft, status }),
  });
}

// ── Écran d'adhésion ───────────────────────────────────────────────────────

/** Native Membership Screening body (TERMS field: 16 rules max, 300 characters each). */
export function screeningPayload(rules, description) {
  return {
    enabled: true,
    description: String(description ?? "").slice(0, 300),
    form_fields: [{
      field_type: "TERMS",
      label: "Lis et accepte le règlement du serveur",
      required: true,
      values: rules.slice(0, 16).map((rule) => `${rule.title} : ${rule.description}`.slice(0, 300)),
    }],
  };
}

async function handleScreeningCommand(interaction, { bot, audit }) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "etat") {
    const { rows } = await sharedQuery("SELECT channel_id, role_id, message_id, native_synced_at FROM screening_config WHERE guild_id = $1", [guild.id]);
    const config = rows[0];
    return reply(interaction, config
      ? `🚪 **Écran d'adhésion**\nSalon : <#${config.channel_id}>\nRôle donné : <@&${config.role_id}>\nScreening natif : ${config.native_synced_at ? `synchronisé <t:${Math.floor(new Date(config.native_synced_at).getTime() / 1000)}:R>` : "non synchronisé"}`
      : "Aucun écran d'adhésion configuré : `/screening configurer`.");
  }
  const draft = await latestDraft(guild.id, ["approved", "published"]);
  if (!draft) return reply(interaction, "❌ Aucun règlement validé : `/reglement generer` puis « Valider ».");

  if (sub === "configurer") {
    const channel = interaction.options.getChannel("salon", true);
    const role = interaction.options.getRole("role", true);
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (role.id === guild.id || role.managed) return reply(interaction, "❌ Choisis un vrai rôle (pas @everyone ni un rôle de bot).");
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) return reply(interaction, "⛔ Il me faut « Gérer les rôles » et être placé au-dessus du rôle choisi.");
    if (!channel.permissionsFor?.(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return reply(interaction, `⛔ Il me faut Envoyer des messages et Intégrer des liens dans <#${channel.id}>.`);
    await interaction.deferReply({ ephemeral: true });
    const pages = rulesToEmbedPages(draft.rules);
    // V2 : écran d'adhésion embelli (étapes, icône, bannière).
    const embeds = pages.slice(0, 10).map((page, index) => {
      const embed = new EmbedBuilder().setColor(0xf0f0f0)
        .setTitle(index === 0 ? `🚪 Bienvenue sur ${guild.name}` : `📜 Règlement — partie ${index + 1}`)
        .setDescription(index === 0 ? `**① Lis le règlement · ② Clique sur « J'accepte » · ③ Profite du serveur**\n\n${page}`.slice(0, 4096) : page);
      if (index === 0 && guild.iconURL?.()) embed.setThumbnail(guild.iconURL({ size: 128 }));
      return embed;
    });
    applyBanner(embeds.at(-1), "verification");
    embeds.at(-1)?.setFooter({ text: "Clique sur « J'accepte » pour accéder au serveur." });
    const sent = await channel.send({
      embeds,
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ACCEPT_ID).setLabel("J'accepte le règlement").setEmoji("✅").setStyle(ButtonStyle.Success))],
      allowedMentions: { parse: [] },
    });
    await sharedQuery(`INSERT INTO screening_config(guild_id, channel_id, role_id, message_id, rules_draft_id, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, role_id = excluded.role_id, message_id = excluded.message_id,
        rules_draft_id = excluded.rules_draft_id, updated_by = excluded.updated_by, updated_at = now()`, [guild.id, channel.id, role.id, sent.id, draft.id, interaction.user.id]);
    await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "screening configurer", outcome: "ok" });
    audit(guild, null, "🚪 Écran d'adhésion configuré", `Par : <@${interaction.user.id}>\nSalon : <#${channel.id}>\nRôle : <@&${role.id}>`);
    return reply(interaction, `✅ Écran d'adhésion publié dans <#${channel.id}> : le bouton donne <@&${role.id}>. Pense à retirer à @everyone l'accès aux autres salons.`);
  }

  if (sub === "synchroniser") {
    await interaction.deferReply({ ephemeral: true });
    try {
      // Endpoint non documenté de Discord : il peut refuser les bots ou changer sans préavis.
      await interaction.client.rest.patch(`/guilds/${guild.id}/member-verification`, { body: screeningPayload(draft.rules, `Règlement de ${guild.name}`) });
      await sharedQuery("UPDATE screening_config SET native_synced_at = now() WHERE guild_id = $1", [guild.id]);
      await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "screening synchroniser", outcome: "ok" });
      return reply(interaction, "✅ Membership Screening natif mis à jour avec le règlement validé.");
    } catch {
      await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "screening synchroniser", outcome: "error", detail: "endpoint refusé" });
      return reply(interaction, [
        "⚠️ Discord refuse que les bots modifient le Membership Screening natif (fonction non documentée pour les bots).",
        "Deux solutions :",
        "• `/screening configurer` : écran d'adhésion par bouton, géré entièrement par le bot ;",
        "• ou copie ces règles dans *Paramètres du serveur → Sécurité → Accès / Règles* :",
        "```",
        draft.rules.slice(0, 16).map((rule, index) => `${index + 1}. ${rule.title} : ${rule.description}`).join("\n").slice(0, 1500),
        "```",
      ].join("\n"));
    }
  }
  return reply(interaction, "Sous-commande inconnue.");
}

async function handleScreeningAccept(interaction, { bot }) {
  const guild = interaction.guild;
  const { rows } = await sharedQuery("SELECT role_id, rules_draft_id FROM screening_config WHERE guild_id = $1", [guild.id]);
  const config = rows[0];
  if (!config) return reply(interaction, "L'écran d'adhésion n'est plus configuré : préviens le staff.");
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(config.role_id)) return reply(interaction, "✅ Tu as déjà accepté le règlement.");
  const screeningRole = guild.roles.cache.get(config.role_id) ?? await guild.roles.fetch(config.role_id).catch(() => null);
  const refused = screeningRole ? await roleGrantRefusal(guild, screeningRole, { automatic: true }) : "Rôle introuvable.";
  if (refused) return reply(interaction, "❌ Le rôle de l'écran d'adhésion est protégé ou introuvable : préviens le staff.");
  try {
    await member.roles.add(config.role_id, "Règlement accepté (écran d'adhésion)");
  } catch {
    return reply(interaction, "❌ Je n'arrive pas à te donner l'accès (permissions du bot). Préviens le staff.");
  }
  await sharedQuery(`INSERT INTO screening_acceptances(guild_id, user_id, rules_draft_id) VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET rules_draft_id = excluded.rules_draft_id, accepted_at = now()`, [guild.id, interaction.user.id, config.rules_draft_id]).catch(() => {});
  await logCommandUsage({ guildId: guild.id, userId: interaction.user.id, bot, command: "screening accepter", outcome: "ok" });
  return reply(interaction, "✅ Merci ! Le règlement est accepté, bienvenue sur le serveur.");
}

/** Entry point (FWU). */
export async function handleEmbedInteraction(interaction, _settings = null, { bot = "fwu", audit = () => {}, ai = {} } = {}) {
  const isOurs = (EMBED_COMMANDS.has(interaction.commandName) && (interaction.isChatInputCommand?.() || interaction.isAutocomplete?.()))
    || (interaction.isModalSubmit?.() && interaction.customId?.startsWith("embed:"))
    || (interaction.isButton?.() && (interaction.customId?.startsWith("rules:") || interaction.customId === ACCEPT_ID));
  if (!isOurs) return false;
  if (!interaction.guild) {
    if (!interaction.isAutocomplete?.()) await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  try {
    if (interaction.isAutocomplete?.()) {
      const query = String(interaction.options.getFocused() ?? "").toLowerCase();
      const { rows } = await sharedQuery("SELECT name FROM embeds WHERE guild_id = $1 AND name LIKE $2 ORDER BY name LIMIT 25", [interaction.guildId, `%${query.replace(/[%_]/g, "")}%`]);
      await interaction.respond(rows.map((row) => ({ name: row.name, value: row.name })));
      return true;
    }
    if (interaction.isButton?.() && interaction.customId === ACCEPT_ID) {
      await handleScreeningAccept(interaction, { bot });
      return true;
    }
    // Tout le reste : admins uniquement, revérifié à chaque interaction (boutons et formulaires compris).
    if (!(await isAdmin(interaction.member))) {
      await reply(interaction, DENIED);
      return true;
    }
    if (interaction.isModalSubmit?.()) await handleEmbedModal(interaction, { bot, audit, ai });
    else if (interaction.isButton?.()) await handleRulesButton(interaction, { bot, audit, ai });
    else if (interaction.commandName === "embed") await handleEmbedCommand(interaction, { bot, audit });
    else if (interaction.commandName === "reglement") await handleReglementCommand(interaction, { bot, audit, ai });
    else if (interaction.commandName === "screening") await handleScreeningCommand(interaction, { bot, audit });
  } catch (error) {
    if (interaction.isAutocomplete?.()) { await interaction.respond([]).catch(() => {}); return true; }
    const message = error instanceof SharedDbUnavailableError || isConnectionError(error) ? UNAVAILABLE : `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    await reply(interaction, message).catch(() => {});
  }
  return true;
}

