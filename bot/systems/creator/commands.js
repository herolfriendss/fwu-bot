import {
  authorizeStudio, cancelSchedule, createClientStudioSender, createDraft, createFromTemplate, findDraftByPrefix,
  getHistory, getDraft, listDrafts, listTemplates, previewDraft, publishDraft, reviewDraft, saveTemplate,
  scheduleDraft, submitDraft, toggleFavorite, updateDraft,
} from "../../creator-studio.js";
import { activeEntitlementKeys } from "../../entitlements.js";
import { isAdminPlus, isSysPlus } from "../sysplus/permissions.js";
import { getAdminPlusRoleId } from "../sysplus/role-config.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";

export const STUDIO_ACTIONS = Object.freeze([
  "create", "submit", "approve", "reject", "schedule", "cancel", "publish", "preview",
  "list", "fav", "history", "template-save", "template-use", "templates", "edit",
]);

const DENIALS = Object.freeze({
  ENTITLEMENT_MISSING: "Le pack **Creator Studio** n'est pas activé sur ce serveur. Demande son attribution aux propriétaires PND.",
  TIER_INSUFFICIENT: "Creator Studio est réservé aux membres **SYS+** ou **ADMIN+**.",
  MODULE_DISABLED: "Creator Studio est désactivé sur ce serveur.",
});

// Undefined when the option is absent, so an edit without mentions keeps the existing ones.
function parseMentions(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return undefined;
  return String(raw).split(/[\s,]+/).map((token) => token.replace(/[<@&!>]/g, "")).filter(Boolean);
}

/**
 * The single business flow for every Studio action. Prefix and slash adapters
 * only translate their input into `params`; authorization, validation and audit
 * all happen here and in the creator-studio service.
 */
export async function runStudioAction({ guild, member, actorId, roleId, params, sender, now = Date.now() }) {
  const adminRoleId = getAdminPlusRoleId(guild.id);
  const tiers = [
    ...(isSysPlus(member, roleId) ? ["SYS_PLUS"] : []),
    ...(isAdminPlus(member, roleId, adminRoleId) ? ["ADMIN_PLUS"] : []),
  ];
  const access = authorizeStudio({ guildId: guild.id, actorId, tiers, entitlements: activeEntitlementKeys(guild.id, now) });
  if (!access.allowed) return `⛔ ${DENIALS[access.code] ?? "Creator Studio refusé."}`;

  const can = true; // authorizeStudio already enforced tiers and the entitlement
  const guildId = guild.id;
  const { action } = params;
  const idOf = () => findDraftByPrefix(guildId, params.id);
  if (!STUDIO_ACTIONS.includes(action)) throw new Error("Action Creator Studio inconnue.");

  if (action === "create") {
    const draft = createDraft({
      guildId, kind: params.kind, actorId, canCreate: can, now,
      input: { title: params.title, body: params.body, color: params.color, footer: params.footer, imageUrl: params.imageUrl,
        mentionUsers: params.mentionUsers ?? [], mentionRoles: params.mentionRoles ?? [], startsAt: params.startsAt, location: params.location, channelId: params.channelId },
    });
    return `✅ Brouillon **${draft.title}** créé : \`${draft.draftId.slice(0, 8)}\`. Envoie-le en relecture avec l'action submit.`;
  }
  if (action === "edit") {
    const draft = updateDraft({
      guildId, draftId: idOf(), actorId, canCreate: can, now,
      input: Object.fromEntries(Object.entries({ title: params.title, body: params.body, color: params.color, footer: params.footer, imageUrl: params.imageUrl,
        mentionUsers: params.mentionUsers, mentionRoles: params.mentionRoles }).filter(([, v]) => v !== undefined)),
    });
    return `✅ Brouillon \`${draft.draftId.slice(0, 8)}\` mis à jour.`;
  }
  if (action === "submit") {
    const draft = submitDraft({ guildId, draftId: idOf(), actorId, canCreate: can, now });
    return `✅ \`${draft.draftId.slice(0, 8)}\` envoyé en relecture. Un second relecteur doit le valider.`;
  }
  if (action === "approve" || action === "reject") {
    if (action === "reject" && !params.note) throw new Error("Un refus doit indiquer la raison (note).");
    const draft = reviewDraft({ guildId, draftId: idOf(), reviewerId: actorId, decision: action === "approve" ? "approve" : "reject", note: params.note, canReview: can, now });
    return action === "approve"
      ? `✅ \`${draft.draftId.slice(0, 8)}\` validé. Il peut maintenant être planifié ou publié.`
      : `↩️ \`${draft.draftId.slice(0, 8)}\` renvoyé en brouillon : ${draft.reviewNote}`;
  }
  if (action === "schedule") {
    const minutes = Number(params.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525_600) throw new Error("Indique un délai entre 1 et 525600 minutes.");
    const draft = scheduleDraft({ guildId, draftId: idOf(), actorId, channelId: params.channelId, at: now + minutes * 60_000, canCreate: can, now });
    return `🗓️ \`${draft.draftId.slice(0, 8)}\` planifié dans ${minutes} min, salon <#${draft.channelId}>.`;
  }
  if (action === "cancel") {
    const draft = cancelSchedule({ guildId, draftId: idOf(), actorId, canCreate: can, now });
    return `↩️ Planification annulée : \`${draft.draftId.slice(0, 8)}\` est de nouveau validé.`;
  }
  if (action === "publish") {
    if (!sender) throw new Error("Expéditeur Discord indisponible.");
    const result = await publishDraft({ guildId, draftId: idOf(), actorId, channelId: params.channelId ?? null, sender, now });
    return result.ok ? `📢 Publié (message ${result.messageId}).` : `❌ Publication échouée : ${result.error}`;
  }
  if (action === "preview") {
    const { text, payload } = previewDraft(getDraft(guildId, idOf()));
    return `${text}\n\n_Aperçu uniquement. Mentions de masse désactivées._ (${payload.embeds.length} embed)`;
  }
  if (action === "list") {
    const rows = listDrafts(guildId, { status: params.status ?? null, limit: 15 });
    return rows.length ? `**Creator Studio**\n${rows.map((d) => `• \`${d.draftId.slice(0, 8)}\` · ${d.kind} · **${d.title}** · ${d.status}`).join("\n")}` : "Aucun brouillon sur ce serveur.";
  }
  if (action === "fav") {
    const result = toggleFavorite({ guildId, userId: actorId, draftId: idOf(), now });
    return result.favorite ? "⭐ Ajouté aux favoris." : "Retiré des favoris.";
  }
  if (action === "history") {
    const rows = getHistory(guildId, idOf(), 10);
    return rows.length ? `**Historique**\n${rows.map((r) => `• <t:${Math.floor(r.at / 1000)}:R> · ${r.action} · <@${r.actorId}>`).join("\n")}` : "Aucun historique.";
  }
  if (action === "template-save") {
    const template = saveTemplate({ guildId, draftId: idOf(), name: params.template, actorId, canCreate: can, now });
    return `💾 Modèle **${template.name}** enregistré (mentions et date exclues).`;
  }
  if (action === "template-use") {
    const draft = createFromTemplate({ guildId, templateName: params.template, input: { title: params.title, body: params.body, mentionUsers: params.mentionUsers ?? [] }, actorId, canCreate: can, now });
    return `✅ Brouillon \`${draft.draftId.slice(0, 8)}\` créé depuis le modèle **${params.template}**.`;
  }
  if (action === "templates") {
    const rows = listTemplates(guildId);
    return rows.length ? `**Modèles**\n${rows.map((t) => `• **${t.name}** · ${t.kind}`).join("\n")}` : "Aucun modèle.";
  }
  throw new Error("Action Creator Studio inconnue.");
}

/** Builds the Discord sender for a client, bound to the guild that owns the draft. */
// Adapters are only reached for guilds already filtered by the bot allowlist in index.js.
export function studioSenderFor(client) {
  return createClientStudioSender(client, { isAllowedGuild: () => true });
}

/** Prefix adapter: args start after "studio", fields are separated by "|". */
export async function handleStudioPrefix(message, args, { roleId, client }) {
  const action = (args[0] ?? "").toLowerCase();
  const rest = args.slice(1).join(" ").split("|").map((part) => part.trim());
  try {
    let params;
    if (action === "create") params = { action, kind: (rest[0] ?? "").toLowerCase(), title: rest[1], body: rest[2], mentionUsers: parseMentions(rest[3]) };
    else if (action === "edit") params = { action, id: rest[0], title: rest[1] || undefined, body: rest[2] || undefined, mentionUsers: parseMentions(rest[3]) };
    else if (action === "template-use") params = { action, template: rest[0], title: rest[1], body: rest[2] };
    else if (action === "template-save") params = { action, id: rest[0], template: rest[1] };
    else if (action === "schedule") params = { action, id: rest[0], minutes: rest[1], channelId: (rest[2] ?? "").replace(/[<#>]/g, "") };
    else if (action === "publish") params = { action, id: rest[0], channelId: rest[1] ? rest[1].replace(/[<#>]/g, "") : null };
    else if (action === "reject" || action === "approve") params = { action, id: rest[0], note: rest[1] || null };
    else if (action === "list" || action === "templates") params = { action };
    else params = { action, id: rest[0] };
    const text = await runStudioAction({ guild: message.guild, member: message.member, actorId: message.author.id, roleId, params, sender: client ? studioSenderFor(client) : null });
    await message.reply({ content: text, allowedMentions: { parse: [] } });
  } catch (error) {
    await message.reply(`❌ ${error instanceof Error ? error.message : "Action Creator Studio impossible."}`);
  }
  return true;
}

/** Slash adapter: /sysp studio action:… with typed options. */
export async function handleStudioInteraction(interaction, { roleId, client }) {
  const params = {
    action: interaction.options.getString("action", true),
    kind: interaction.options.getString("type") ?? "announcement",
    id: interaction.options.getString("id"),
    title: interaction.options.getString("titre") ?? undefined,
    body: interaction.options.getString("contenu") ?? undefined,
    color: interaction.options.getString("couleur") ?? undefined,
    imageUrl: interaction.options.getString("image") ?? undefined,
    note: interaction.options.getString("note") ?? null,
    minutes: interaction.options.getInteger("minutes"),
    channelId: interaction.options.getChannel("salon")?.id ?? null,
    template: interaction.options.getString("modele") ?? undefined,
    mentionUsers: parseMentions(interaction.options.getString("mentions")),
    status: null,
  };
  try {
    const text = await runStudioAction({
      guild: interaction.guild, member: interaction.member, actorId: interaction.user.id, roleId, params,
      sender: client ? studioSenderFor(client) : null,
    });
    await interaction.reply({ content: text, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error instanceof Error ? error.message : "Action Creator Studio impossible."}`, ephemeral: true });
  }
  return true;
}
