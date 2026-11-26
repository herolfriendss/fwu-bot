// FWU — SYS+ : rôle perso d'un membre, depuis le panneau /rolepanel panel.
//
// Un SYS+ choisit un membre, tape un nom et une couleur : le bot crée un rôle SANS aucune
// permission Discord, le place au niveau du rôle le plus haut du membre (jamais au-dessus de
// l'auteur ni du bot : le membre ne gagne aucun rang), et le donne au membre.
// Un seul rôle perso par membre ; renommer, recolorer ou retirer se fait au même endroit.
// Hiérarchie : le membre doit être strictement sous le SYS+ (sauf lui-même) ; l'OWNER et le
// propriétaire du serveur ont l'accès total.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from "discord.js";
import { db } from "../../database.js";
import { parsePndOwnerId } from "../../pnd-owner-policy.js";
import { recordSysPlusAudit } from "./audit.js";
import { normalizeCustomRoleColor, normalizeCustomRoleName } from "./custom-roles-policy.js";

export const MEMBER_ROLE_PREFIX = "rolepanel:custom:mrole";
export const MEMBER_ROLE_LIMIT = 100;

db.exec(`
  CREATE TABLE IF NOT EXISTS sysplus_member_roles (
    guild_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, member_id)
  );
`);
const getRow = db.prepare("SELECT role_id, created_by FROM sysplus_member_roles WHERE guild_id=? AND member_id=?");
const countRows = db.prepare("SELECT COUNT(*) AS n FROM sysplus_member_roles WHERE guild_id=?");
const insertRow = db.prepare("INSERT INTO sysplus_member_roles(guild_id,member_id,role_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)");
const touchRow = db.prepare("UPDATE sysplus_member_roles SET updated_at=? WHERE guild_id=? AND member_id=?");
const deleteRow = db.prepare("DELETE FROM sysplus_member_roles WHERE guild_id=? AND member_id=?");

const fullAccess = (actor, guild) => actor.id === guild.ownerId || actor.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);

/** Pure: may `actor` manage the personal role of `target`? */
export function memberRoleTargetDecision({ actorId, targetId, targetIsBot, actorPosition, targetPosition, guildOwnerId, ownerId }) {
  if (!targetId) return "Membre introuvable sur ce serveur.";
  if (targetIsBot) return "Un bot ne peut pas avoir de rôle perso.";
  if (actorId === targetId || actorId === guildOwnerId || actorId === ownerId) return null;
  if (targetId === ownerId) return "L'OWNER est protégé.";
  if (!(Number(actorPosition) > Number(targetPosition))) return "Tu ne peux configurer le rôle perso que d'un membre placé sous ton rôle le plus élevé.";
  return null;
}

/**
 * Pure: where to place the new role. With `targetPosition`, the role goes right where the
 * member's highest role is (that role slides one step down), so the member keeps the same
 * rank: a personal role placed just under the SYS+ would otherwise lift the member above
 * every staff member in between (the bots compare highest-role positions).
 * Always under the highest role the bot and the actor can manage.
 */
export function memberRolePosition({ actorPosition, botPosition, actorFull, targetPosition = null }) {
  const ceiling = Math.max(1, (actorFull ? Number(botPosition) : Math.min(Number(actorPosition), Number(botPosition))) - 1);
  if (targetPosition == null || !Number.isFinite(Number(targetPosition))) return ceiling;
  return Math.max(1, Math.min(ceiling, Number(targetPosition)));
}

async function loadTarget(guild, actor, memberId) {
  const target = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);
  const refusal = memberRoleTargetDecision({
    actorId: actor.id,
    targetId: target?.id,
    targetIsBot: Boolean(target?.user?.bot),
    actorPosition: actor.roles.highest.position,
    targetPosition: target?.roles?.highest?.position ?? 0,
    guildOwnerId: guild.ownerId,
    ownerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID),
  });
  if (refusal) throw new Error(refusal);
  return target;
}

export function memberRolePickerComponents() {
  return [
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${MEMBER_ROLE_PREFIX}:pick`).setPlaceholder("Choisis le membre").setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("rolepanel:custom:home").setLabel("Retour").setStyle(ButtonStyle.Secondary)),
  ];
}

function memberRoleView(guild, target, role) {
  const embed = new EmbedBuilder().setColor(role?.color || 0xe21d2f).setTitle("🎨 Rôle perso d'un membre").setDescription(role
    ? `Membre : <@${target.id}>\nRôle : <@&${role.id}>\nCouleur : #${role.color.toString(16).padStart(6, "0").toUpperCase()}`
    : `Membre : <@${target.id}>\nAucun rôle perso pour l'instant.`).setFooter({ text: `${guild.name} • Panel SYS+` });
  const buttons = role
    ? [
      new ButtonBuilder().setCustomId(`${MEMBER_ROLE_PREFIX}:rename:${target.id}`).setLabel("Renommer").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${MEMBER_ROLE_PREFIX}:color:${target.id}`).setLabel("Couleur").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${MEMBER_ROLE_PREFIX}:remove:${target.id}`).setLabel("Retirer").setStyle(ButtonStyle.Danger),
    ]
    : [new ButtonBuilder().setCustomId(`${MEMBER_ROLE_PREFIX}:create:${target.id}`).setLabel("Créer son rôle").setStyle(ButtonStyle.Success)];
  buttons.push(new ButtonBuilder().setCustomId("rolepanel:custom:home").setLabel("Retour").setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}

function memberRoleModal(action, actorId, memberId) {
  const modal = new ModalBuilder().setCustomId(`${MEMBER_ROLE_PREFIX}:modal:${action}:${actorId}:${memberId}`)
    .setTitle(action === "create" ? "Rôle perso du membre" : action === "rename" ? "Renommer le rôle perso" : "Couleur du rôle perso");
  if (action !== "color") modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nom du rôle (2 à 32 caractères)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)));
  if (action !== "rename") modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Couleur : nom (rose, bleu…) ou #RRGGBB").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7)));
  return modal;
}

async function currentRole(guild, memberId) {
  const row = getRow.get(guild.id, memberId);
  if (!row) return null;
  const role = await guild.roles.fetch(row.role_id, { force: true }).catch(() => null);
  if (!role) { deleteRow.run(guild.id, memberId); return null; }
  return role;
}

export async function createMemberRole({ guild, actor, botMember, target, name, color }) {
  if (await currentRole(guild, target.id)) throw new Error("Ce membre a déjà un rôle perso : modifie-le plutôt.");
  if (countRows.get(guild.id).n >= MEMBER_ROLE_LIMIT) throw new Error(`Limite atteinte : ${MEMBER_ROLE_LIMIT} rôles perso sur ce serveur.`);
  const role = await guild.roles.create({
    name: normalizeCustomRoleName(name),
    color: Number.parseInt(normalizeCustomRoleColor(color).slice(1), 16),
    permissions: [],
    hoist: false,
    mentionable: false,
    reason: `Rôle perso de ${target.id} créé par ${actor.id}`,
  });
  try {
    await role.setPosition(memberRolePosition({ actorPosition: actor.roles.highest.position, botPosition: botMember.roles.highest.position, actorFull: fullAccess(actor, guild), targetPosition: target.roles?.highest?.position ?? null })).catch(() => {});
    await target.roles.add(role, `Rôle perso donné par ${actor.id}`);
    insertRow.run(guild.id, target.id, role.id, actor.id, Date.now(), Date.now());
  } catch (error) {
    await role.delete("Nettoyage : rôle perso non attribué").catch(() => {});
    throw error;
  }
  recordSysPlusAudit(guild.id, actor.id, "sysplus.member_role.create", target.id, { roleId: role.id, name: role.name });
  return role;
}

export async function editMemberRole({ guild, actor, target, action, name, color }) {
  const role = await currentRole(guild, target.id);
  if (!role) throw new Error("Ce membre n'a pas de rôle perso.");
  const changes = action === "rename" ? { name: normalizeCustomRoleName(name) } : { color: Number.parseInt(normalizeCustomRoleColor(color).slice(1), 16) };
  await role.edit(changes, `Rôle perso de ${target.id} modifié par ${actor.id}`);
  touchRow.run(Date.now(), guild.id, target.id);
  recordSysPlusAudit(guild.id, actor.id, `sysplus.member_role.${action}`, target.id, { roleId: role.id });
  return role;
}

export async function removeMemberRole({ guild, actor, target }) {
  const role = await currentRole(guild, target.id);
  if (!role) throw new Error("Ce membre n'a pas de rôle perso.");
  await role.delete(`Rôle perso de ${target.id} retiré par ${actor.id}`);
  deleteRow.run(guild.id, target.id);
  recordSysPlusAudit(guild.id, actor.id, "sysplus.member_role.remove", target.id, { roleId: role.id });
  return role;
}

/** Handles every `rolepanel:custom:mrole:*` component. `actor` and `botMember` are already SYS+-checked. */
export async function handleMemberRoleComponent(interaction, { actor, botMember }) {
  const guild = interaction.guild;
  const parts = interaction.customId.split(":");
  const action = parts[3];
  if (interaction.isUserSelectMenu?.() && action === "pick") {
    const target = await loadTarget(guild, actor, interaction.values[0]);
    await interaction.update(memberRoleView(guild, target, await currentRole(guild, target.id)));
    return true;
  }
  if (interaction.isButton?.()) {
    const target = await loadTarget(guild, actor, parts[4]);
    if (action === "create" || action === "rename" || action === "color") {
      await interaction.showModal(memberRoleModal(action, actor.id, target.id));
      return true;
    }
    if (action === "remove") {
      await removeMemberRole({ guild, actor, target });
      await interaction.update(memberRoleView(guild, target, null));
      return true;
    }
  }
  if (interaction.isModalSubmit?.() && action === "modal") {
    const [, , , , kind, expectedActorId, memberId] = parts;
    if (actor.id !== expectedActorId) throw new Error("Ce formulaire appartient à un autre membre.");
    const target = await loadTarget(guild, actor, memberId);
    const name = kind === "color" ? undefined : interaction.fields.getTextInputValue("name");
    const color = kind === "rename" ? undefined : interaction.fields.getTextInputValue("color");
    const role = kind === "create"
      ? await createMemberRole({ guild, actor, botMember, target, name, color })
      : await editMemberRole({ guild, actor, target, action: kind, name, color });
    await interaction.reply({ content: kind === "create" ? `✅ Rôle perso <@&${role.id}> créé et donné à <@${target.id}> (aucune permission Discord).` : `✅ Rôle perso de <@${target.id}> modifié : <@&${role.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

/** Payload showing a member's personal role (for /rolepanel membre). */
export async function memberRolePanel(guild, actor, memberId) {
  const target = await loadTarget(guild, actor, memberId);
  return memberRoleView(guild, target, await currentRole(guild, target.id));
}
