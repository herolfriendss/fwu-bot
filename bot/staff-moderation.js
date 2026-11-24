// FWU — modération staff : /tempmute, /sanction, /sanction-type, /quota.
// Tout passe par la base centrale (shared/) : types de sanctions, historique,
// quotas partagés avec les 4 autres bots, exemptions et whitelist.
import { EmbedBuilder } from "discord.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";
import { ModerationRefusal, runModerationAction } from "./moderation-actions.js";
import { appealButton, recordModerationCase } from "./moderation.js";
import { SharedDbUnavailableError, isConnectionError } from "./shared/db.js";
import {
  QUOTA_COMMANDS, addExemption, addWhitelistedBot, formatDurationFr, listExemptions, listQuotas, listWhitelistedBots,
  recentConfigChanges, removeExemption, removeWhitelistedBot, resetQuota, setQuota,
} from "./shared/quotas.js";
import {
  addSanctionType, deleteSanctionType, getSanctionType, listMemberSanctions, listSanctionTypes, parseDurationToSeconds, updateSanctionType,
} from "./shared/sanctions.js";
import { TIER_LABELS, canUseModeration, listRoleTiers, memberTier, ownerId, setRoleTier } from "./shared/tiers.js";

export const STAFF_COMMANDS = new Set(["tempmute", "sanction", "sanction-type", "quota"]);
const ACTION_ICONS = { tempmute: "🔇", unmute: "🔊", warn: "⚠️", kick: "👢", ban: "🔨", unban: "♻️", blacklist: "⛔" };
const UNAVAILABLE = "🛑 La base centrale est injoignable : action impossible pour le moment. Réessaie dans un instant.";
const SNOWFLAKE = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/;

export function parseUserReference(value) {
  const match = SNOWFLAKE.exec(String(value ?? "").trim());
  return match ? (match[1] ?? match[2]) : null;
}

/** "4" → 4, "0" → 0, "illimité" → null. Throws on anything else. */
export function parseQuotaValue(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (["illimite", "illimité", "unlimited", "∞", "infini"].includes(text)) return null;
  if (!/^\d{1,5}$/.test(text)) throw new Error("Valeur invalide : un nombre (0 = interdit) ou « illimité ».");
  return Number(text);
}

function describeValue(value) {
  if (value == null) return "∅";
  return "```json\n" + JSON.stringify(value).slice(0, 300) + "\n```";
}

async function reply(interaction, content, extra = {}) {
  const payload = { content, ephemeral: true, allowedMentions: { parse: [] }, ...extra };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function sanctionTypeLabel(type) {
  return `${type.name} — ${formatDurationFr(type.durationSeconds)}`;
}

async function auditConfig(guild, settings, actorId, title, before, after) {
  await sendCentralLog(guild, settings, systemLogEmbed({
    title: `⚙️ ${title}`,
    description: `Par : <@${actorId}>\n**Avant**\n${describeValue(before)}\n**Après**\n${describeValue(after)}`,
    color: 0x6d28d9,
  })).catch(() => {});
}

// ── Autocomplétion ─────────────────────────────────────────────────────────

async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "sanction") return interaction.respond([]);
  try {
    const query = String(focused.value ?? "").toLowerCase();
    const types = await listSanctionTypes(interaction.guildId);
    await interaction.respond(types
      .filter((type) => !query || type.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((type) => ({ name: sanctionTypeLabel(type).slice(0, 100), value: type.id })));
  } catch {
    await interaction.respond([]).catch(() => {});
  }
}

/** Accept an id (autocomplete) or a typed name. */
async function resolveSanctionType(guildId, raw) {
  const byId = await getSanctionType(guildId, raw);
  if (byId) return byId;
  const name = String(raw ?? "").trim().toLowerCase();
  return (await listSanctionTypes(guildId)).find((type) => type.name.toLowerCase() === name) ?? null;
}

// ── /tempmute ──────────────────────────────────────────────────────────────

async function handleTempmute(interaction, settings, bot) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const user = interaction.options.getUser("membre", true);
  const type = await resolveSanctionType(guild.id, interaction.options.getString("sanction", true));
  if (!type) return reply(interaction, "❌ Sanction inconnue. Choisis-la dans la liste proposée (`/sanction-type liste`).");
  const target = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!target) return reply(interaction, "❌ Ce membre n'est pas sur le serveur.");
  const reason = String(interaction.options.getString("raison") ?? "").trim();
  const { caseId } = await runModerationAction({
    guild, actor: interaction.member, command: "tempmute", bot, targetId: user.id, targetMember: target, targetUser: user,
    reason, durationSeconds: type.durationSeconds, sanctionTypeId: type.id, sanctionLabel: type.name, settings,
    recordCase: recordModerationCase, appealButton,
    execute: () => target.timeout(type.durationSeconds * 1000, `${type.name}${reason ? ` — ${reason}` : ""} (par ${interaction.user.id})`.slice(0, 500)),
  });
  const until = Math.floor((Date.now() + type.durationSeconds * 1000) / 1000);
  return reply(interaction, `🔇 ${caseId ? `Dossier #${caseId} · ` : ""}<@${user.id}> exclu temporairement **${formatDurationFr(type.durationSeconds)}** pour **${type.name}** (fin <t:${until}:R>).`);
}

// ── /sanction ──────────────────────────────────────────────────────────────

export function formatSanctionLine(item) {
  const date = `<t:${Math.floor(item.createdAt.getTime() / 1000)}:d>`;
  const what = `${ACTION_ICONS[item.action] ?? "•"} **${item.action}**${item.label ? ` · ${item.label}` : ""}${item.durationSeconds ? ` · ${formatDurationFr(item.durationSeconds)}` : ""}`;
  const reason = item.reason ? ` — ${item.reason.slice(0, 120)}` : "";
  return `${date} ${what} · par <@${item.moderatorId}> (${item.bot})${reason}`;
}

async function handleSanctionHistory(interaction, tier) {
  if (!canUseModeration(tier)) return reply(interaction, "⛔ Réservé au staff (palier 50 % minimum).");
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.options.getUser("membre", true);
  const page = interaction.options.getInteger("page") ?? 1;
  const { total, items } = await listMemberSanctions(interaction.guildId, user.id, { limit: 10, offset: (page - 1) * 10 });
  const pages = Math.max(1, Math.ceil(total / 10));
  const embed = new EmbedBuilder().setColor(0x6d28d9)
    .setTitle(`📁 Sanctions de ${user.tag ?? user.username ?? user.id}`)
    .setDescription(items.length ? items.map(formatSanctionLine).join("\n").slice(0, 4000) : total ? "Page vide." : "✅ Aucune sanction enregistrée.")
    .setFooter({ text: `${total} sanction(s) au total · page ${Math.min(page, pages)}/${pages} · tous bots confondus` });
  return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// ── /sanction-type ─────────────────────────────────────────────────────────

async function handleSanctionType(interaction, settings, tier, bot) {
  const sub = interaction.options.getSubcommand();
  if (sub === "liste") {
    if (!canUseModeration(tier)) return reply(interaction, "⛔ Réservé au staff (palier 50 % minimum).");
    const types = await listSanctionTypes(interaction.guildId);
    return reply(interaction, types.length ? `📋 **Sanctions prédéfinies**\n${types.map((type) => `• ${sanctionTypeLabel(type)}`).join("\n")}` : "Aucune sanction prédéfinie : ajoute-en avec `/sanction-type ajouter`.");
  }
  if (!(tier === 0 || (tier != null && tier <= 5))) return reply(interaction, "⛔ Seuls les admins (palier 5 % ou plus haut) modifient les sanctions prédéfinies.");
  const guild = interaction.guild;
  const actorId = interaction.user.id;
  if (sub === "ajouter") {
    const seconds = parseDurationToSeconds(interaction.options.getString("duree", true));
    if (!seconds) return reply(interaction, "❌ Durée illisible : utilise 10m, 1h, 1h30, 2j…");
    const created = await addSanctionType({ guildId: guild.id, name: interaction.options.getString("nom", true), durationSeconds: seconds, actorId, bot });
    await auditConfig(guild, settings, actorId, "Sanction prédéfinie ajoutée", null, { name: created.name, duree: formatDurationFr(created.durationSeconds) });
    return reply(interaction, `✅ Sanction ajoutée : **${sanctionTypeLabel(created)}**.`);
  }
  const type = await resolveSanctionType(guild.id, interaction.options.getString("sanction", true));
  if (!type) return reply(interaction, "❌ Sanction introuvable.");
  if (sub === "modifier") {
    const rawDuration = interaction.options.getString("duree");
    const seconds = rawDuration ? parseDurationToSeconds(rawDuration) : null;
    if (rawDuration && !seconds) return reply(interaction, "❌ Durée illisible : utilise 10m, 1h, 1h30, 2j…");
    const name = interaction.options.getString("nom");
    if (!name && !seconds) return reply(interaction, "ℹ️ Indique un nouveau nom et/ou une nouvelle durée.");
    const { before, after } = await updateSanctionType({ guildId: guild.id, id: type.id, name, durationSeconds: seconds, actorId, bot });
    await auditConfig(guild, settings, actorId, "Sanction prédéfinie modifiée", { name: before.name, duree: formatDurationFr(before.durationSeconds) }, { name: after.name, duree: formatDurationFr(after.durationSeconds) });
    return reply(interaction, `✅ **${before.name}** (${formatDurationFr(before.durationSeconds)}) → **${after.name}** (${formatDurationFr(after.durationSeconds)}).`);
  }
  if (sub === "supprimer") {
    const deleted = await deleteSanctionType({ guildId: guild.id, id: type.id, actorId, bot });
    await auditConfig(guild, settings, actorId, "Sanction prédéfinie supprimée", { name: deleted.name, duree: formatDurationFr(deleted.durationSeconds) }, null);
    return reply(interaction, `🗑️ Sanction supprimée : **${sanctionTypeLabel(deleted)}**. L'historique des sanctions déjà données est conservé.`);
  }
  return reply(interaction, "Sous-commande inconnue.");
}

// ── /quota ─────────────────────────────────────────────────────────────────

export function formatQuotaTable(quotas, onlyCommand = null) {
  const lines = [];
  for (const command of QUOTA_COMMANDS) {
    if (onlyCommand && command !== onlyCommand) continue;
    const rows = quotas.filter((q) => q.command === command).sort((a, b) => b.tier - a.tier);
    if (!rows.length) continue;
    const cells = rows.map((q) => {
      const value = q.maxUses == null ? "illimité" : q.maxUses === 0 ? "interdit" : `${q.maxUses} / ${formatDurationFr(q.windowSeconds)}`;
      return `${q.tier} % : ${value}${q.isDefault ? "" : " ✏️"}`;
    });
    lines.push(`**${command}** — ${cells.join(" · ")}`);
  }
  return lines.join("\n");
}

async function handleQuota(interaction, settings, tier, bot) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const actorId = interaction.user.id;
  const owner = ownerId();

  if (!group && sub === "voir") {
    if (!canUseModeration(tier)) return reply(interaction, "⛔ Réservé au staff (palier 50 % minimum).");
    const quotas = await listQuotas(guild.id);
    const table = formatQuotaTable(quotas, interaction.options.getString("commande"));
    return reply(interaction, `📊 **Quotas de modération** (partagés entre les 5 bots)\nTon palier : **${TIER_LABELS[tier] ?? "aucun"}**${tier === 0 ? " — illimité" : ""}\n0 % · Owner et bots whitelistés : illimité\n${table}\n\n✏️ = valeur propre à ce serveur.`.slice(0, 2000));
  }
  // Tout le reste : owner uniquement.
  if (!owner || actorId !== owner) return reply(interaction, "⛔ Seul l'owner peut modifier les quotas, les paliers, la whitelist et les exemptions.");
  await interaction.deferReply({ ephemeral: true });

  if (!group && sub === "definir") {
    const command = interaction.options.getString("commande", true);
    const quotaTier = interaction.options.getInteger("palier", true);
    const maxUses = parseQuotaValue(interaction.options.getString("valeur", true));
    const windowSeconds = parseDurationToSeconds(interaction.options.getString("fenetre", true));
    if (!windowSeconds) return reply(interaction, "❌ Fenêtre illisible : utilise 30m, 1h, 1j…");
    const { before, after } = await setQuota({ guildId: guild.id, command, tier: quotaTier, maxUses, windowSeconds, actorId, owner, bot });
    await auditConfig(guild, settings, actorId, `Quota modifié · ${command} · ${quotaTier} %`, before, after);
    const fmt = (v) => (!v ? "aucun" : v.maxUses == null ? "illimité" : `${v.maxUses} / ${formatDurationFr(v.windowSeconds)}`);
    return reply(interaction, `✅ Quota **${command}** pour **${TIER_LABELS[quotaTier]}** : ${fmt(before)} → **${fmt(after)}**. Effet immédiat sur les 5 bots.`);
  }
  if (!group && sub === "reinitialiser") {
    const command = interaction.options.getString("commande", true);
    const quotaTier = interaction.options.getInteger("palier", true);
    const result = await resetQuota({ guildId: guild.id, command, tier: quotaTier, actorId, owner, bot });
    if (!result.changed) return reply(interaction, "ℹ️ Ce quota utilise déjà la valeur par défaut.");
    await auditConfig(guild, settings, actorId, `Quota réinitialisé · ${command} · ${quotaTier} %`, result.before, { reset: "défaut" });
    return reply(interaction, `♻️ Quota **${command}** / **${TIER_LABELS[quotaTier]}** revenu à la valeur par défaut.`);
  }
  if (!group && sub === "palier") {
    const role = interaction.options.getRole("role", true);
    const chosen = interaction.options.getInteger("palier", true);
    const result = await setRoleTier({ guildId: guild.id, roleId: role.id, tier: chosen === -1 ? null : chosen, actorId, bot });
    await auditConfig(guild, settings, actorId, `Palier du rôle ${role.name}`, result.before == null ? null : { palier: result.before }, result.after == null ? null : { palier: result.after });
    return reply(interaction, chosen === -1 ? `✅ Association retirée pour <@&${role.id}> (le nom du rôle reste utilisé s'il contient un pourcentage).` : `✅ <@&${role.id}> → **${TIER_LABELS[chosen]}**.`);
  }
  if (!group && sub === "paliers") {
    const rows = await listRoleTiers(guild.id);
    const detected = [...(guild.roles?.cache?.values?.() ?? [])]
      .filter((role) => !rows.some((row) => row.roleId === role.id) && /\d\s?%/.test(role.name)).map((role) => `<@&${role.id}>`);
    return reply(interaction, `🎚️ **Paliers**\n${rows.length ? rows.map((row) => `• <@&${row.roleId}> → ${TIER_LABELS[row.tier]}`).join("\n") : "Aucune association explicite."}${detected.length ? `\nReconnus par leur nom : ${detected.join(", ")}` : ""}\nL'owner (\`PND_OWNER_DISCORD_ID\`) est toujours au palier 0 %.`);
  }
  if (!group && sub === "journal") {
    const rows = await recentConfigChanges(guild.id, 10);
    if (!rows.length) return reply(interaction, "Aucune modification enregistrée.");
    const lines = rows.map((row) => `<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R> <@${row.actor_id}> · **${row.entity}** \`${row.entity_key}\` : ${JSON.stringify(row.before) ?? "∅"} → ${JSON.stringify(row.after) ?? "∅"}`);
    return reply(interaction, `🧾 **Dernières modifications**\n${lines.join("\n")}`.slice(0, 2000));
  }
  if (group === "exemption") {
    if (sub === "liste") {
      const rows = await listExemptions(guild.id);
      return reply(interaction, rows.length ? `🛡️ **Exemptés de quota**\n${rows.map((row) => `• <@${row.userId}> (\`${row.userId}\`)${row.reason ? ` — ${row.reason}` : ""}`).join("\n")}` : "Aucune exemption.");
    }
    const userId = parseUserReference(interaction.options.getString("utilisateur", true));
    if (!userId) return reply(interaction, "❌ Mention ou identifiant Discord invalide.");
    if (sub === "ajouter") {
      const reason = interaction.options.getString("raison") ?? "";
      const result = await addExemption({ guildId: guild.id, userId, reason, actorId, owner, bot });
      if (result.changed) await auditConfig(guild, settings, actorId, "Exemption de quota ajoutée", null, { utilisateur: userId, raison: reason });
      return reply(interaction, result.changed ? `✅ <@${userId}> est exempté de tous les quotas.` : `ℹ️ <@${userId}> était déjà exempté.`);
    }
    const result = await removeExemption({ guildId: guild.id, userId, actorId, owner, bot });
    if (result.changed) await auditConfig(guild, settings, actorId, "Exemption de quota retirée", { utilisateur: userId }, null);
    return reply(interaction, result.changed ? `✅ Exemption retirée pour <@${userId}>.` : `ℹ️ <@${userId}> n'était pas exempté.`);
  }
  if (group === "bot") {
    if (sub === "liste") {
      const rows = await listWhitelistedBots(guild.id);
      return reply(interaction, rows.length ? `🤖 **Bots whitelistés**\n${rows.map((row) => `• <@${row.botId}> (\`${row.botId}\`)`).join("\n")}` : "Aucun bot whitelisté.");
    }
    const botId = parseUserReference(interaction.options.getString("bot", true));
    if (!botId) return reply(interaction, "❌ Mention ou identifiant de bot invalide.");
    if (sub === "ajouter") {
      const member = await guild.members.fetch(botId).catch(() => null);
      if (member && !member.user.bot) return reply(interaction, "❌ Ce compte n'est pas un bot : utilise `/quota exemption ajouter`.");
      const result = await addWhitelistedBot({ guildId: guild.id, botId, actorId, owner, bot });
      if (result.changed) await auditConfig(guild, settings, actorId, "Bot ajouté à la whitelist des quotas", null, { bot: botId });
      return reply(interaction, result.changed ? `✅ <@${botId}> outrepasse désormais les quotas.` : "ℹ️ Ce bot était déjà whitelisté.");
    }
    const result = await removeWhitelistedBot({ guildId: guild.id, botId, actorId, owner, bot });
    if (result.changed) await auditConfig(guild, settings, actorId, "Bot retiré de la whitelist des quotas", { bot: botId }, null);
    return reply(interaction, result.changed ? `✅ <@${botId}> est retiré de la whitelist.` : "ℹ️ Ce bot n'était pas whitelisté.");
  }
  return reply(interaction, "Sous-commande inconnue.");
}

/** Entry point (FWU). Returns true when the interaction was handled. */
export async function handleStaffModerationInteraction(interaction, settings = null, { bot = "fwu" } = {}) {
  if (!STAFF_COMMANDS.has(interaction.commandName)) return false;
  if (interaction.isAutocomplete?.()) {
    await handleAutocomplete(interaction);
    return true;
  }
  if (!interaction.isChatInputCommand?.()) return false;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  try {
    const tier = await memberTier(interaction.member);
    if (interaction.commandName === "tempmute") await handleTempmute(interaction, settings, bot);
    else if (interaction.commandName === "sanction") await handleSanctionHistory(interaction, tier);
    else if (interaction.commandName === "sanction-type") await handleSanctionType(interaction, settings, tier, bot);
    else if (interaction.commandName === "quota") await handleQuota(interaction, settings, tier, bot);
  } catch (error) {
    const message = error instanceof ModerationRefusal
      ? `❌ ${error.message}`
      : error instanceof SharedDbUnavailableError || isConnectionError(error)
        ? UNAVAILABLE
        : `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    await reply(interaction, message).catch(() => {});
  }
  return true;
}
