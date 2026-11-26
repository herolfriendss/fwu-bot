import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
} from "discord.js";
import { canUseAdminPlusScope, getAdminPlusScope } from "./systems/sysplus/admin-plus-scopes.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { roleAssignmentDecision } from "./role-policy.js";
import { assertRoleGrantable } from "./role-grant-guard.js";
import { blrGrantRefusal } from "./blr.js";
import { systemLogEmbed, sendCentralLog } from "./logs.js";
import { herBotAvatar, themePanelEmbed } from "./theme.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import {
  RANKALL_MAX_MEMBERS,
  cancelRankAllPreview,
  canUndoRankAllJob,
  claimRankAllJob,
  createRankAllPreview,
  dangerousRolePermissions,
  executeRankAllJob,
  getRankAllJob,
  planRankAll,
  requestRankAllStop,
  undoRankAllJob,
} from "./rankall-runner.js";

const P = PermissionFlagsBits;
const MEMBER_SELECT = "herrole:member";

function canManageRoles(member, settings) {
  const adminRoleId = settings?.adminPlus?.roleId ?? getAdminPlusRoleId(member?.guild?.id);
  return canUseAdminPlusScope(member, settings?.sysPlus?.roleId ?? null, adminRoleId, "roles", getAdminPlusScope(member?.guild?.id, "roles"));
}

function hierarchyError(actor, target, role, botMember) {
  return roleAssignmentDecision({
    actorId: actor.id,
    ownerId: actor.guild.ownerId,
    pndOwnerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID),
    targetId: target.id,
    actorPosition: actor.roles.highest.position,
    targetPosition: target.roles.highest.position,
    roleId: role.id,
    everyoneRoleId: actor.guild.id,
    rolePosition: role.position,
    roleManaged: role.managed,
    botId: botMember.id,
    botPosition: botMember.roles.highest.position,
  }).reason;
}

async function applyRole({ guild, actor, targetId, roleId, add, settings }) {
  const freshActor = await guild.members.fetch({ user: actor.id, force: true });
  if (!canManageRoles(freshActor, settings)) throw new Error("Accès réservé aux membres SYS+ ou ADMIN+ autorisés.");
  const [target, role, botMember] = await Promise.all([
    guild.members.fetch({ user: targetId, force: true }).catch(() => null),
    guild.roles.fetch(roleId, { force: true }).catch(() => null),
    guild.members.fetchMe({ force: true }),
  ]);
  if (!target) throw new Error("Membre introuvable sur ce serveur.");
  if (!role) throw new Error("Rôle introuvable.");
  if (!botMember.permissions.has(P.ManageRoles)) throw new Error("Je dois avoir la permission Gérer les rôles.");
  const denied = hierarchyError(freshActor, target, role, botMember);
  if (denied) throw new Error(denied);
  // SYS+, ADMIN+, WHITELIST, rôles de palier et rôles à permissions sensibles : OWNER seulement.
  await assertRoleGrantable(guild, role, { actorId: freshActor.id, settings, removal: !add, targetId: target.id });
  const hasRole = target.roles.cache.has(role.id);
  if (add && hasRole) return { changed: false, target, role };
  if (!add && !hasRole) return { changed: false, target, role };
  if (add) await target.roles.add(role, `Gestion des rôles par ${actor.id}`);
  else await target.roles.remove(role, `Gestion des rôles par ${actor.id}`);
  recordSysPlusAudit(guild.id, actor.id, add ? "role.add" : "role.remove", target.id, { roleId: role.id, roleName: role.name });
  await sendCentralLog(guild, settings, systemLogEmbed({ category: "permissions", title: add ? "🎭 Rôle attribué" : "🎭 Rôle retiré", description: `Acteur : <@${actor.id}>\nCible : <@${target.id}>\nRôle : <@&${role.id}>` })).catch(() => {});
  return { changed: true, target, role };
}

function isPndOwner(userId) {
  const owner = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  return Boolean(owner && owner === userId);
}

const RANKALL_DENIED = "⛔ Commande réservée au propriétaire configuré des bots.";

/** Shared preview for =rankall and /rankall. Throws user-facing errors; mutates nothing on Discord. */
async function buildRankAllPreview(guild, actorId, roleId, settings = null) {
  const [actor, botMember, role] = await Promise.all([
    guild.members.fetch({ user: actorId, force: true }),
    guild.members.fetchMe({ force: true }),
    guild.roles.fetch(roleId, { force: true }),
  ]);
  if (!role) throw new Error("Rôle introuvable.");
  if (role.managed || role.id === guild.id) throw new Error("Ce rôle est protégé ou géré par une intégration.");
  const dangerous = dangerousRolePermissions(role);
  if (dangerous.length) throw new Error(`Refusé : ce rôle porte des permissions sensibles (${dangerous.join(", ")}). Une attribution générale ne peut concerner qu'un rôle cosmétique ou d'accès.`);
  await assertRoleGrantable(guild, role, { automatic: true, settings });
  if (!botMember.permissions.has(P.ManageRoles)) throw new Error("Je dois avoir la permission Gérer les rôles.");
  const members = await guild.members.fetch();
  const plan = planRankAll({ members: [...members.values()], role, guild, actor, botMember, blocked: (member) => (blrGrantRefusal(guild.id, member.id, role) ? "membre BLR" : null) });
  if (!plan.eligible.length) throw new Error("Aucun membre éligible à cette attribution.");
  if (plan.eligible.length > RANKALL_MAX_MEMBERS) throw new Error(`Trop de membres concernés (${plan.eligible.length}). Plafond : ${RANKALL_MAX_MEMBERS}.`);
  const job = createRankAllPreview({ guildId: guild.id, actorId, roleId: role.id, eligibleCount: plan.eligible.length, skippedCount: plan.skipped.length });
  const sample = plan.eligible.slice(0, 10).map((member) => member.displayName ?? member.user?.username ?? member.id).join(", ");
  const reasons = new Map();
  for (const item of plan.skipped) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  const reasonLines = [...reasons.entries()].slice(0, 4).map(([reason, count]) => `  • ${count} — ${reason}`).join("\n");
  const content = [
    "⚠️ **Attribution générale — aperçu**",
    `Rôle : <@&${role.id}>`,
    `Membres concernés : **${plan.eligible.length}**`,
    `Déjà titulaires : **${plan.alreadyHolding}** · Bots exclus : **${plan.bots}**`,
    `Ignorés (hiérarchie/protection) : **${plan.skipped.length}**${reasonLines ? `\n${reasonLines}` : ""}`,
    `Exemples : ${sample}${plan.eligible.length > 10 ? "…" : ""}`,
    "",
    "Confirme dans les 60 secondes. Tu pourras arrêter l'opération en cours, puis l'annuler pendant 15 minutes.",
  ].join("\n");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rankall:confirm:${job.id}`).setLabel(`Confirmer pour ${plan.eligible.length} membres`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rankall:abort:${job.id}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
  return { content, components: [row], allowedMentions: { parse: [] } };
}

function rankAllSummary(title, role, result, skipped) {
  return `${title}\nRôle : <@&${role.id}>\nAttribués : **${result.assigned}**\nÉchecs / changements de hiérarchie : **${result.failed}**${skipped != null ? `\nIgnorés au précontrôle : **${skipped}**` : ""}`;
}

async function editRankAllMessage(interaction, payload) {
  try { await interaction.editReply(payload); }
  catch {
    // Interaction tokens expire after 15 minutes; fall back to the message itself when possible.
    await interaction.message?.edit?.(payload).catch(() => {});
  }
}

async function handleRankAllButton(interaction, settings) {
  const [, action, jobId] = interaction.customId.split(":");
  const job = getRankAllJob(jobId);
  if (!interaction.guild || !job || job.guildId !== interaction.guild.id) {
    await interaction.reply({ content: "Cette attribution est introuvable ou a expiré.", ephemeral: true });
    return true;
  }
  if (!isPndOwner(interaction.user.id)) {
    await interaction.reply({ content: RANKALL_DENIED, ephemeral: true });
    return true;
  }
  if (interaction.user.id !== job.actorId) {
    await interaction.reply({ content: "Cette attribution appartient à un autre utilisateur.", ephemeral: true });
    return true;
  }

  if (action === "abort") {
    const cancelled = cancelRankAllPreview(jobId, interaction.user.id);
    await interaction.update({ content: cancelled ? "✖️ Attribution générale annulée. Aucun rôle n'a été modifié." : "Cette attribution n'est plus en attente.", components: [], allowedMentions: { parse: [] } });
    return true;
  }

  if (action === "stop") {
    const requested = requestRankAllStop(jobId, interaction.user.id);
    await interaction.reply({ content: requested ? "⏹️ Arrêt demandé : l'opération s'interrompt après le membre en cours." : "Cette attribution n'est plus en cours.", ephemeral: true });
    return true;
  }

  if (action === "undo") {
    const check = canUndoRankAllJob(job, interaction.user.id);
    if (!check.ok) {
      await interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    const role = await interaction.guild.roles.fetch(job.roleId, { force: true }).catch(() => null);
    if (!role) {
      await editRankAllMessage(interaction, { content: "❌ Le rôle n'existe plus : rien à retirer.", components: [] });
      return true;
    }
    await editRankAllMessage(interaction, { content: `↩️ Annulation en cours : retrait de <@&${role.id}> à ${job.assigned.length} membre(s)…`, components: [], allowedMentions: { parse: [] } });
    const result = await undoRankAllJob({ job, guild: interaction.guild, role });
    recordSysPlusAudit(interaction.guild.id, interaction.user.id, "role.rankall_undo", null, { jobId, roleId: role.id, removed: result.removed, failed: result.failed });
    await sendCentralLog(interaction.guild, settings, systemLogEmbed({ category: "permissions", title: "↩️ Attribution générale annulée", description: `Acteur : <@${interaction.user.id}>\nRôle : <@&${role.id}>\nRetirés : **${result.removed}**\nDéjà retirés : **${result.skipped}**\nÉchecs : **${result.failed}**` })).catch(() => {});
    await editRankAllMessage(interaction, { content: result.alreadyUndone ? "ℹ️ Cette attribution a déjà été annulée." : `↩️ **Annulation terminée**\nRôle : <@&${role.id}>\nRetirés : **${result.removed}**\nDéjà retirés : **${result.skipped}**\nÉchecs : **${result.failed}**`, components: [], allowedMentions: { parse: [] } });
    return true;
  }

  if (action !== "confirm") return false;
  const claim = claimRankAllJob(jobId, interaction.user.id);
  if (!claim.ok) {
    await interaction.reply({ content: claim.reason, ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  const stopRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rankall:stop:${jobId}`).setLabel("Arrêter").setStyle(ButtonStyle.Secondary));
  try {
    const [actor, botMember, role] = await Promise.all([
      interaction.guild.members.fetch({ user: interaction.user.id, force: true }),
      interaction.guild.members.fetchMe({ force: true }),
      interaction.guild.roles.fetch(job.roleId, { force: true }),
    ]);
    if (!role || role.managed || role.id === interaction.guild.id) throw new Error("Ce rôle est introuvable ou protégé.");
    if (dangerousRolePermissions(role).length) throw new Error("Ce rôle a reçu des permissions sensibles depuis l'aperçu : attribution refusée.");
    await assertRoleGrantable(interaction.guild, role, { automatic: true, settings });
    if (!botMember.permissions.has(P.ManageRoles)) throw new Error("Permission Gérer les rôles manquante.");
    const members = await interaction.guild.members.fetch();
    const plan = planRankAll({ members: [...members.values()], role, guild: interaction.guild, actor, botMember });
    await editRankAllMessage(interaction, { content: `⏳ Attribution de <@&${role.id}> en cours : 0/${plan.eligible.length}…`, components: [stopRow], allowedMentions: { parse: [] } });
    const result = await executeRankAllJob({
      job: claim.job,
      guild: interaction.guild,
      role,
      actor,
      botMember,
      members: plan.eligible,
      canManageRoles: () => botMember.permissions.has(P.ManageRoles),
      onProgress: (progress) => editRankAllMessage(interaction, { content: `⏳ Attribution de <@&${role.id}> en cours : ${progress.processed}/${progress.total} · attribués ${progress.assigned} · échecs ${progress.failed}`, components: [stopRow], allowedMentions: { parse: [] } }),
    });
    recordSysPlusAudit(interaction.guild.id, interaction.user.id, "role.rankall", null, { jobId, roleId: role.id, roleName: role.name, assigned: result.assigned, failed: result.failed, status: result.status });
    const title = result.status === "stopped" ? `⏹️ **Attribution arrêtée** (${result.processed}/${result.total})` : "✅ **Attribution terminée**";
    await sendCentralLog(interaction.guild, settings, systemLogEmbed({ category: "permissions", title: "🎭 Attribution générale de rôle", description: `Acteur : <@${interaction.user.id}>\n${rankAllSummary(title, role, result, plan.skipped.length)}` })).catch(() => {});
    const undoRow = result.assigned
      ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rankall:undo:${jobId}`).setLabel("Annuler l'attribution (15 min)").setStyle(ButtonStyle.Secondary))]
      : [];
    await editRankAllMessage(interaction, { content: rankAllSummary(title, role, result, plan.skipped.length), components: undoRow, allowedMentions: { parse: [] } });
  } catch (error) {
    await editRankAllMessage(interaction, { content: `❌ ${error instanceof Error ? error.message : "Attribution interrompue."}`, components: [] });
  }
  return true;
}

function panelRows(memberId = null, roleId = null) {
  if (!memberId) {
    return [new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(MEMBER_SELECT).setPlaceholder("Choisir un membre").setMinValues(1).setMaxValues(1),
    )];
  }
  if (!roleId) {
    return [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`herrole:member:${memberId}`).setPlaceholder("Changer de membre").setMinValues(1).setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`herrole:role:${memberId}`).setPlaceholder("Choisir un rôle").setMinValues(1).setMaxValues(1),
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`herrole:member:${memberId}`).setPlaceholder("Changer de membre").setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(`herrole:role:${memberId}:${roleId}`).setPlaceholder("Changer de rôle").setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`herrole:apply:add:${memberId}:${roleId}`).setLabel("Ajouter le rôle").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`herrole:apply:remove:${memberId}:${roleId}`).setLabel("Retirer le rôle").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function replyResult(interaction, add, result) {
  const verb = add ? "attribué à" : "retiré à";
  const status = result.changed ? "✅" : "ℹ️";
  const content = result.changed
    ? `${status} Le rôle **${result.role.name}** a été ${verb} **${result.target.displayName}**.`
    : `${status} Aucun changement : **${result.target.displayName}** ${add ? "possède déjà" : "ne possède pas"} le rôle **${result.role.name}**.`;
  await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
}

export async function handleRoleMessage(message, settings = {}) {
  const [command] = message.content.trim().split(/\s+/);
  const name = command?.toLowerCase();
  if (name === "=rankall") {
    if (!message.guild || !message.member) return true;
    if (!isPndOwner(message.author.id)) {
      await message.reply({ content: RANKALL_DENIED, allowedMentions: { parse: [] } });
      return true;
    }
    const role = message.mentions.roles.first();
    if (!role) {
      await message.reply({ content: "Utilisation : `=rankall @rôle`.", allowedMentions: { parse: [] } });
      return true;
    }
    try {
      await message.reply(await buildRankAllPreview(message.guild, message.author.id, role.id, settings));
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } });
    }
    return true;
  }
  if (name !== "=rank" && name !== "=addrole" && name !== "=removerole") return false;
  if (!message.guild || !message.member) return true;
  try {
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!target || !role) throw new Error(`Utilisation : \`${name} @membre @rôle\`.`);
    const result = await applyRole({ guild: message.guild, actor: message.member, targetId: target.id, roleId: role.id, add: name !== "=removerole", settings });
    await message.reply({ content: result.changed ? `✅ Rôle **${role.name}** ${name !== "=removerole" ? "ajouté à" : "retiré à"} **${target.displayName}**.` : "ℹ️ Aucun changement nécessaire.", allowedMentions: { parse: [] } });
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } });
  }
  return true;
}

export async function handleRoleInteraction(interaction, settings = {}) {
  if (interaction.isChatInputCommand() && interaction.commandName === "rankall") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
      return true;
    }
    if (!isPndOwner(interaction.user.id)) {
      await interaction.reply({ content: RANKALL_DENIED, ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const role = interaction.options.getRole("role", true);
      await interaction.editReply(await buildRankAllPreview(interaction.guild, interaction.user.id, role.id, settings));
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, components: [] }).catch(() => {});
    }
    return true;
  }
  const isRolePanelManage = interaction.isChatInputCommand()
    && interaction.commandName === "rolepanel"
    && interaction.options.getSubcommand(false) === "manage";
  if (interaction.isChatInputCommand() && (["rank", "removerole"].includes(interaction.commandName) || isRolePanelManage)) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
      return true;
    }
    const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!actor || !canManageRoles(actor, settings)) {
      await interaction.reply({ content: "⛔ Accès réservé aux membres SYS+ ou ADMIN+ autorisés.", ephemeral: true });
      return true;
    }
    if (interaction.commandName === "rolepanel") {
      const embed = themePanelEmbed(new EmbedBuilder().setTitle("🌙 Gestion des rôles").setDescription("Choisis un membre, puis un rôle. Tu pourras ensuite l'ajouter ou le retirer. Les permissions et la hiérarchie sont revérifiées à chaque action."), { thumbnailUrl: herBotAvatar(interaction.guild) });
      await interaction.reply({ embeds: [embed], components: panelRows(), ephemeral: true });
      return true;
    }
    const target = interaction.options.getMember("membre") ?? await interaction.guild.members.fetch(interaction.options.getUser("membre", true).id).catch(() => null);
    const role = interaction.options.getRole("role", true);
    if (!target) {
      await interaction.reply({ content: "Membre introuvable.", ephemeral: true });
      return true;
    }
    try {
      const result = await applyRole({ guild: interaction.guild, actor, targetId: target.id, roleId: role.id, add: interaction.commandName !== "removerole", settings });
      await replyResult(interaction, interaction.commandName !== "removerole", result);
    } catch (error) {
      await interaction.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, ephemeral: true });
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith("rankall:")) {
    return handleRankAllButton(interaction, settings);
  }
  if (!interaction.isMessageComponent() || !interaction.customId.startsWith("herrole:")) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "Cette interaction doit être utilisée dans un serveur.", ephemeral: true });
    return true;
  }
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor || !canManageRoles(actor, settings)) {
    await interaction.reply({ content: "⛔ Tu n'as plus les permissions nécessaires.", ephemeral: true });
    return true;
  }
  const [scope, action, a, b] = interaction.customId.split(":");
  try {
    if (action === "member" && (interaction.isUserSelectMenu())) {
      const memberId = interaction.values[0];
      const panel = themePanelEmbed(new EmbedBuilder().setTitle("🌙 Gestion des rôles").setDescription(`Membre sélectionné : <@${memberId}>. Choisis maintenant un rôle.`), { thumbnailUrl: herBotAvatar(interaction.guild) });
      await interaction.update({ content: null, embeds: [panel], components: panelRows(memberId), allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "role" && interaction.isRoleSelectMenu()) {
      const memberId = a;
      const roleId = interaction.values[0];
      const panel = themePanelEmbed(new EmbedBuilder().setTitle("🌙 Gestion des rôles").setDescription(`Membre : <@${memberId}>\nRôle : <@&${roleId}>\nChoisis l'action à effectuer.`), { thumbnailUrl: herBotAvatar(interaction.guild) });
      await interaction.update({ content: null, embeds: [panel], components: panelRows(memberId, roleId), allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "apply" && interaction.isButton()) {
      const operation = a;
      const memberId = b;
      const roleId = interaction.customId.split(":")[4];
      const result = await applyRole({ guild: interaction.guild, actor, targetId: memberId, roleId, add: operation === "add", settings });
      const add = operation === "add";
      await interaction.update({ content: result.changed ? `✅ Rôle **${result.role.name}** ${add ? "attribué à" : "retiré à"} **${result.target.displayName}**.` : "ℹ️ Aucun changement nécessaire.", embeds: [], components: [], allowedMentions: { parse: [] } });
      return true;
    }
  } catch (error) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, ephemeral: true }).catch(() => {});
    return true;
  }
  return false;
}
