import { respondInPlaceSafe } from "../../interaction-reply.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "../../database.js";
import { recordSysPlusAudit } from "./audit.js";
import { isSysPlus } from "./permissions.js";
import {
  customRoleHierarchyDecision,
  customRoleQuotaDecision,
  normalizeCustomRoleColor,
  normalizeCustomRoleName,
} from "./custom-roles-policy.js";
import { MEMBER_ROLE_PREFIX, handleMemberRoleComponent, memberRolePanel, memberRolePickerComponents } from "./member-roles.js";

const P = PermissionFlagsBits;
const PREFIX = "rolepanel:custom";

db.exec(`
  CREATE TABLE IF NOT EXISTS sysplus_custom_roles (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );
  CREATE INDEX IF NOT EXISTS sysplus_custom_roles_creator_idx ON sysplus_custom_roles(guild_id, created_by);
`);

const rowsForGuild = db.prepare("SELECT role_id, created_by, created_at, updated_at FROM sysplus_custom_roles WHERE guild_id=? ORDER BY created_at DESC");
const trackedRole = db.prepare("SELECT role_id, created_by FROM sysplus_custom_roles WHERE guild_id=? AND role_id=?");
const countByCreator = db.prepare("SELECT COUNT(*) AS count FROM sysplus_custom_roles WHERE guild_id=? AND created_by=?");
const countByGuild = db.prepare("SELECT COUNT(*) AS count FROM sysplus_custom_roles WHERE guild_id=?");
const insertRole = db.prepare("INSERT INTO sysplus_custom_roles(guild_id,role_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?)");
const touchRole = db.prepare("UPDATE sysplus_custom_roles SET updated_at=? WHERE guild_id=? AND role_id=?");
const deleteRoleRecord = db.prepare("DELETE FROM sysplus_custom_roles WHERE guild_id=? AND role_id=?");
const pendingCreatorCreates = new Set();

async function authorizeActor(guild, userId, settings) {
  const [actor, botMember] = await Promise.all([
    guild.members.fetch({ user: userId, force: true }).catch(() => null),
    guild.members.fetchMe({ force: true }).catch(() => null),
  ]);
  const sysRoleId = settings?.sysPlus?.roleId ?? null;
  if (!actor || !isSysPlus(actor, sysRoleId)) throw new Error("Accès réservé au rôle SYS+.");
  if (!botMember?.permissions?.has(P.ManageRoles)) throw new Error("Le bot doit disposer de la permission Gérer les rôles.");
  return { actor, botMember };
}

function verifyRoleHierarchy({ actor, botMember, role, guild }) {
  const result = customRoleHierarchyDecision({
    actorIsGuildOwner: actor.id === guild.ownerId,
    actorPosition: actor.roles.highest.position,
    botPosition: botMember.roles.highest.position,
    rolePosition: role.position,
    roleManaged: role.managed,
    roleIsEveryone: role.id === guild.id,
  });
  if (!result.allowed) throw new Error(result.reason);
}

async function createCustomRole({ guild, actor, botMember, name, color }) {
  const normalizedName = normalizeCustomRoleName(name);
  const normalizedColor = normalizeCustomRoleColor(color);
  const creatorKey = `${guild.id}:${actor.id}`;
  if (pendingCreatorCreates.has(creatorKey)) {
    throw new Error("Une création de rôle est déjà en cours pour ton compte. Réessaie après sa fin.");
  }
  pendingCreatorCreates.add(creatorKey);
  try {
    const quota = customRoleQuotaDecision({
      creatorCount: countByCreator.get(guild.id, actor.id).count,
      guildCount: countByGuild.get(guild.id).count,
    });
    if (!quota.allowed) throw new Error(quota.reason);
    const role = await guild.roles.create({
      name: normalizedName,
      color: Number.parseInt(normalizedColor.slice(1), 16),
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: `Rôle personnalisé SYS+ créé par ${actor.id}`,
    });
    try {
      insertRole.run(guild.id, role.id, actor.id, Date.now(), Date.now());
    } catch (error) {
      await role.delete("Nettoyage après échec d'enregistrement du rôle personnalisé").catch(() => {});
      throw error;
    }
    recordSysPlusAudit(guild.id, actor.id, "sysplus.custom_role.create", role.id, { name: role.name, color: normalizedColor, permissions: "0" });
    return role;
  } finally {
    pendingCreatorCreates.delete(creatorKey);
  }
}

async function editCustomRole({ guild, actor, botMember, roleId, name, color, action }) {
  const row = trackedRole.get(guild.id, roleId);
  if (!row) throw new Error("Ce rôle n'est pas géré par le panel SYS+.");
  if (row.created_by !== actor.id && actor.id !== (process.env.PND_OWNER_DISCORD_ID ?? "").trim()) {
    throw new Error("Tu peux uniquement modifier les rôles que tu as créés.");
  }
  const role = await guild.roles.fetch(roleId, { force: true }).catch(() => null);
  if (!role) throw new Error("Le rôle personnalisé n'existe plus.");
  verifyRoleHierarchy({ actor, botMember, role, guild });
  const changes = {};
  if (action === "rename") changes.name = normalizeCustomRoleName(name);
  if (action === "color") changes.color = Number.parseInt(normalizeCustomRoleColor(color).slice(1), 16);
  if (!Object.keys(changes).length) throw new Error("Aucune modification demandée.");
  await role.edit(changes, `Rôle personnalisé SYS+ modifié par ${actor.id}`);
  touchRole.run(Date.now(), guild.id, role.id);
  recordSysPlusAudit(guild.id, actor.id, `sysplus.custom_role.${action}`, role.id, changes);
  return role;
}

async function deleteCustomRole({ guild, actor, botMember, roleId }) {
  const row = trackedRole.get(guild.id, roleId);
  if (!row) throw new Error("Ce rôle n'est pas géré par le panel SYS+.");
  if (row.created_by !== actor.id && actor.id !== (process.env.PND_OWNER_DISCORD_ID ?? "").trim()) {
    throw new Error("Tu peux uniquement supprimer les rôles que tu as créés.");
  }
  const role = await guild.roles.fetch(roleId, { force: true }).catch(() => null);
  if (!role) {
    deleteRoleRecord.run(guild.id, roleId);
    throw new Error("Le rôle n'existe plus ; son entrée locale a été nettoyée.");
  }
  verifyRoleHierarchy({ actor, botMember, role, guild });
  await role.delete(`Rôle personnalisé SYS+ supprimé par ${actor.id}`);
  deleteRoleRecord.run(guild.id, roleId);
  recordSysPlusAudit(guild.id, actor.id, "sysplus.custom_role.delete", roleId, { name: role.name });
  return role;
}

function customRolesEmbed(guild, selectedRole = null) {
  const records = rowsForGuild.all(guild.id);
  const body = selectedRole
    ? `**${selectedRole.name}**\nCouleur : #${selectedRole.color.toString(16).padStart(6, "0").toUpperCase()}\nID : ${selectedRole.id}\n\nSélectionne une action ci-dessous.`
    : `Rôles enregistrés : **${records.length}/25**\nQuota : **1 rôle personnalisé par membre**\n\nCrée et gère ici les rôles personnalisés SYS+. Les rôles créés ont toujours **zéro permission Discord**. Les permissions natives et la hiérarchie restent prioritaires.`;
  return new EmbedBuilder().setColor(0x6d28d9).setTitle("🌙 SYS+ — Rôles personnalisés").setDescription(body).setFooter({ text: `${guild.name} • Panel SYS+` });
}

function customRoleComponents(guild, selectedRole = null) {
  if (selectedRole) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:rename:${selectedRole.id}`).setLabel("Renommer").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:color:${selectedRole.id}`).setLabel("Changer la couleur").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:delete:${selectedRole.id}`).setLabel("Supprimer").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIX}:home`).setLabel("Retour").setStyle(ButtonStyle.Secondary),
      ),
    ];
  }
  const records = rowsForGuild.all(guild.id).slice(0, 25);
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:create`).setLabel("Créer un rôle").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:member`).setLabel("Rôle perso d'un membre").setEmoji("🎨").setStyle(ButtonStyle.Primary),
  )];
  if (records.length) {
    const options = records.map((record) => {
      const role = guild.roles.cache.get(record.role_id);
      return role ? { label: role.name.slice(0, 100), value: role.id, description: `Créé par ${record.created_by}`.slice(0, 100) } : null;
    }).filter(Boolean);
    if (options.length) rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${PREFIX}:select`).setPlaceholder("Choisir un rôle à modifier").addOptions(options),
    ));
  }
  return rows;
}

function roleModal({ action, actorId, roleId = null, title }) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:modal:${action}:${actorId}${roleId ? `:${roleId}` : ""}`).setTitle(title);
  const name = new TextInputBuilder().setCustomId("name").setLabel("Nom du rôle (2 à 32 caractères)").setStyle(TextInputStyle.Short).setRequired(action !== "color").setMaxLength(32);
  const color = new TextInputBuilder().setCustomId("color").setLabel("Couleur hexadécimale (#RRGGBB)").setStyle(TextInputStyle.Short).setRequired(action !== "rename").setMaxLength(7);
  if (action !== "color") modal.addComponents(new ActionRowBuilder().addComponents(name));
  if (action !== "rename") modal.addComponents(new ActionRowBuilder().addComponents(color));
  return modal;
}

export async function handleCustomRolesMessage(message, settings = {}) {
  if (!message?.guild || !message?.member || !/^=rolepanel(?:\s|$)/i.test(message.content.trim())) return false;
  const [, action = "panel", ...args] = message.content.trim().split(/\s+/);
  try {
    const { actor, botMember } = await authorizeActor(message.guild, message.author.id, settings);
    if (action === "panel" || action === "list") {
      const records = rowsForGuild.all(message.guild.id);
      const body = records.length ? records.map((row) => {
        const role = message.guild.roles.cache.get(row.role_id);
        return role ? `• <@&${role.id}> — créateur <@${row.created_by}>` : `• rôle supprimé (ID ${row.role_id})`;
      }).join("\n") : "Aucun rôle personnalisé pour ce serveur.";
      await message.reply({ content: `**SYS+ — rôles personnalisés**\n${body}\n\n` + "`=rolepanel create Nom | #RRGGBB` · `rename ID | Nom` · `color ID | #RRGGBB` · `delete ID CONFIRMER`", allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "create") {
      const payload = message.content.trim().replace(/^=rolepanel\s+create\s+/i, "");
      const [name, color] = payload.split("|").map((part) => part.trim());
      const role = await createCustomRole({ guild: message.guild, actor, botMember, name, color });
      await message.reply({ content: `✅ Rôle personnalisé créé : <@&${role.id}> (aucune permission Discord).`, allowedMentions: { parse: [] } });
      return true;
    }
    if (["rename", "color"].includes(action)) {
      const payload = message.content.trim().replace(new RegExp(`^=rolepanel\\s+${action}\\s+`, "i"), "");
      const [roleId, value] = payload.split("|").map((part) => part.trim());
      const role = await editCustomRole({ guild: message.guild, actor, botMember, roleId, action, ...(action === "rename" ? { name: value } : { color: value }) });
      await message.reply({ content: `✅ Rôle personnalisé mis à jour : <@&${role.id}>.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "delete") {
      const [roleId, confirmation] = args;
      if (confirmation !== "CONFIRMER") throw new Error("Confirme la suppression avec `=rolepanel delete ID CONFIRMER`.");
      const role = await deleteCustomRole({ guild: message.guild, actor, botMember, roleId });
      await message.reply({ content: `🗑️ Rôle personnalisé **${role.name}** supprimé.`, allowedMentions: { parse: [] } });
      return true;
    }
    throw new Error("Utilise `=rolepanel panel`, `create Nom | #RRGGBB`, `rename ID | Nom`, `color ID | #RRGGBB` ou `delete ID CONFIRMER`.");
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } });
    return true;
  }
}

export async function handleCustomRolesInteraction(interaction, settings = {}) {
  const isCommand = interaction.isChatInputCommand?.() && interaction.commandName === "rolepanel";
  const isCustomComponent = (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isModalSubmit?.())
    && interaction.customId?.startsWith(`${PREFIX}:`);
  if (!isCommand && !isCustomComponent) return false;
  if (!interaction.guild) {
    if (interaction.isRepliable?.()) await interaction.reply({ content: "Cette action doit être utilisée dans un serveur.", ephemeral: true });
    return true;
  }
  if (isCommand && interaction.options.getSubcommand() === "manage") return false;
  try {
    const { actor, botMember } = await authorizeActor(interaction.guild, interaction.user.id, settings);
    if (isCustomComponent && interaction.customId.startsWith(`${MEMBER_ROLE_PREFIX}:`)) {
      return await handleMemberRoleComponent(interaction, { actor, botMember });
    }
    if (isCommand) {
      const action = interaction.options.getSubcommand();
      if (action === "membre") {
        await interaction.reply({ ...(await memberRolePanel(interaction.guild, actor, interaction.options.getUser("membre", true).id)), ephemeral: true });
        return true;
      }
      if (action === "panel" || action === "list") {
        const records = rowsForGuild.all(interaction.guild.id);
        const summary = records.map((row) => {
          const role = interaction.guild.roles.cache.get(row.role_id);
          return role ? `• <@&${role.id}> — créateur <@${row.created_by}>` : null;
        }).filter(Boolean);
        // One message only: the list (when asked) travels in the same reply as the panel.
        await interaction.reply({
          ...(action === "list" ? { content: (summary.length ? summary.join("\n") : "Aucun rôle personnalisé.").slice(0, 2000) } : {}),
          embeds: [customRolesEmbed(interaction.guild)],
          components: customRoleComponents(interaction.guild),
          ephemeral: true,
          allowedMentions: { parse: [] },
        });
        return true;
      }
      if (action === "create") {
        const role = await createCustomRole({ guild: interaction.guild, actor, botMember, name: interaction.options.getString("nom", true), color: interaction.options.getString("couleur", true) });
        await interaction.reply({ content: `✅ Rôle personnalisé créé : <@&${role.id}>. Aucune permission Discord n'a été ajoutée.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "rename" || action === "color") {
        const role = await editCustomRole({ guild: interaction.guild, actor, botMember, roleId: interaction.options.getRole("role", true).id, action, ...(action === "rename" ? { name: interaction.options.getString("nom", true) } : { color: interaction.options.getString("couleur", true) }) });
        await interaction.reply({ content: `✅ Rôle personnalisé modifié : <@&${role.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "delete") {
        if (!interaction.options.getBoolean("confirmer", true)) throw new Error("La suppression doit être explicitement confirmée.");
        const role = await deleteCustomRole({ guild: interaction.guild, actor, botMember, roleId: interaction.options.getRole("role", true).id });
        await interaction.reply({ content: `🗑️ Rôle personnalisé **${role.name}** supprimé.`, ephemeral: true });
        return true;
      }
      return false;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId === `${PREFIX}:select`) {
      const roleId = interaction.values[0];
      if (!trackedRole.get(interaction.guild.id, roleId)) throw new Error("Ce rôle n'est pas géré par le panel SYS+.");
      const role = await interaction.guild.roles.fetch(roleId, { force: true }).catch(() => null);
      if (!role) throw new Error("Rôle introuvable.");
      verifyRoleHierarchy({ actor, botMember, role, guild: interaction.guild });
      await interaction.update({ embeds: [customRolesEmbed(interaction.guild, role)], components: customRoleComponents(interaction.guild, role), allowedMentions: { parse: [] } });
      return true;
    }
    if (interaction.isButton?.()) {
      const [, , action, roleId] = interaction.customId.split(":");
      if (action === "member") {
        await interaction.update({ content: "", embeds: [new EmbedBuilder().setColor(0x6d28d9).setTitle("🎨 Rôle perso d'un membre").setDescription("Choisis le membre. Tu pourras créer son rôle (nom + couleur), le modifier ou le retirer. Le rôle n'a aucune permission Discord.")], components: memberRolePickerComponents(), allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "home") {
        await interaction.update({ embeds: [customRolesEmbed(interaction.guild)], components: customRoleComponents(interaction.guild), allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "create") {
        await interaction.showModal(roleModal({ action, actorId: actor.id, title: "Créer un rôle personnalisé" }));
        return true;
      }
      if (action === "rename" || action === "color") {
        const row = trackedRole.get(interaction.guild.id, roleId);
        if (!row || (row.created_by !== actor.id && actor.id !== (process.env.PND_OWNER_DISCORD_ID ?? "").trim())) throw new Error("Tu ne peux pas modifier ce rôle.");
        await interaction.showModal(roleModal({ action, actorId: actor.id, roleId, title: action === "rename" ? "Renommer le rôle" : "Changer la couleur" }));
        return true;
      }
      if (action === "delete") {
        const row = trackedRole.get(interaction.guild.id, roleId);
        if (!row || (row.created_by !== actor.id && actor.id !== (process.env.PND_OWNER_DISCORD_ID ?? "").trim())) throw new Error("Tu ne peux pas supprimer ce rôle.");
        const expiry = Date.now() + 60_000;
        await interaction.update({ content: `⚠️ Confirmer la suppression du rôle <@&${roleId}> ?`, embeds: [], components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:delete-confirm:${actor.id}:${roleId}:${expiry}`).setLabel("Confirmer la suppression").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:home`).setLabel("Annuler").setStyle(ButtonStyle.Secondary),
        )], allowedMentions: { parse: [] } });
        return true;
      }
      if (action === "delete-confirm") {
        const [, , , expectedActorId, expectedRoleId, expiresAt] = interaction.customId.split(":");
        if (actor.id !== expectedActorId || Date.now() > Number(expiresAt)) throw new Error("Confirmation expirée ou réservée à un autre membre.");
        const role = await deleteCustomRole({ guild: interaction.guild, actor, botMember, roleId: expectedRoleId });
        await interaction.update({ content: `🗑️ Rôle personnalisé **${role.name}** supprimé.`, embeds: [], components: [], allowedMentions: { parse: [] } });
        return true;
      }
    }
    if (interaction.isModalSubmit?.()) {
      const [, , marker, action, expectedActorId, roleId] = interaction.customId.split(":");
      if (marker !== "modal" || actor.id !== expectedActorId) throw new Error("Ce formulaire appartient à un autre membre.");
      const name = action === "color" ? undefined : interaction.fields.getTextInputValue("name");
      const color = action === "rename" ? undefined : interaction.fields.getTextInputValue("color");
      if (action === "create") {
        const role = await createCustomRole({ guild: interaction.guild, actor, botMember, name, color });
        await interaction.reply({ content: `✅ Rôle personnalisé créé : <@&${role.id}>. Aucune permission Discord n'a été ajoutée.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      const role = await editCustomRole({ guild: interaction.guild, actor, botMember, roleId, action, name, color });
      await interaction.reply({ content: `✅ Rôle personnalisé modifié : <@&${role.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.isRepliable?.()) await respondInPlaceSafe(interaction, { content, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  return true;
}
