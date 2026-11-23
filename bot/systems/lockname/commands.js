import { PermissionFlagsBits } from "discord.js";
import { db } from "../../database.js";
import { sendCentralLog, systemLogEmbed } from "../../logs.js";
import { recordSysPlusAudit } from "../sysplus/audit.js";
import { canUseAdminPlusScope, getAdminPlusScope } from "../sysplus/admin-plus-scopes.js";
import { getAdminPlusRoleId } from "../sysplus/role-config.js";
import { isMemberDogged } from "../../dog-commands.js";
import { canProtectNickname, protectedNicknameRestore } from "./policy.js";

function settingsFor(raw, guildId) {
  return raw?.[guildId] ?? raw ?? {};
}

function logLockname(guild, settings, title, description) {
  return sendCentralLog(guild, settings, systemLogEmbed({ title, description, color: 0x6d28d9 }));
}

function targetIdFromMessage(message) {
  const part = message.content.trim().split(/\s+/)[1];
  return message.mentions.members.first()?.id ?? part?.match(/^<@!?(\d{5,25})>$/)?.[1] ?? (part && /^\d{5,25}$/.test(part) ? part : null);
}

async function requireOperator(guild, actorId, rawSettings) {
  const settings = settingsFor(rawSettings, guild.id);
  const actor = await guild.members.fetch({ user: actorId, force: true });
  const sysRoleId = settings.sysPlus?.roleId ?? null;
  const adminRoleId = settings.adminPlus?.roleId ?? getAdminPlusRoleId(guild.id);
  if (!canUseAdminPlusScope(actor, sysRoleId, adminRoleId, "lockname", getAdminPlusScope(guild.id, "lockname"))) throw new Error("LOCKNAME est réservé aux membres SYS+ et aux ADMIN+ autorisés sur ce module.");
  if (!actor.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    throw new Error("Tu dois aussi posséder la permission Discord « Gérer les pseudos ».");
  }
  return { actor, settings };
}

async function changeLock(guild, actorId, targetId, action, rawSettings) {
  const { actor } = await requireOperator(guild, actorId, rawSettings);
  const target = await guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!target) throw new Error("Je ne trouve pas ce membre sur le serveur.");

  if (action === "protect") {
    if (target.user.bot || target.id === guild.ownerId || target.id === actor.id) {
      throw new Error("LOCKNAME ne peut pas protéger ce compte.");
    }
    const bot = await guild.members.fetchMe();
    const allowed = canProtectNickname({
      actorId: actor.id,
      ownerId: guild.ownerId,
      targetId: target.id,
      targetIsOwner: target.id === guild.ownerId,
      actorIsGuildOwner: actor.id === guild.ownerId,
      actorRolePosition: actor.roles.highest.position,
      targetRolePosition: target.roles.highest.position,
      botRolePosition: bot.roles.highest.position,
      actorCanManageNicknames: actor.permissions.has(PermissionFlagsBits.ManageNicknames),
      botCanManageNicknames: bot.permissions.has(PermissionFlagsBits.ManageNicknames),
      privileged: true,
    });
    if (!allowed) throw new Error("La hiérarchie des rôles ou les permissions Discord empêchent cette action.");
    if (await isMemberDogged(guild.id, target.id)) throw new Error("Retire d’abord la laisse DOG avant d’activer LOCKNAME.");
    const existing = db.prepare("SELECT 1 FROM protected_nicknames WHERE guild_id=? AND member_id=?").get(guild.id, target.id);
    if (existing) throw new Error("Ce pseudonyme est déjà protégé. Utilise `/lockname retirer` pour désactiver la protection.");
    db.prepare("INSERT INTO protected_nicknames(guild_id,member_id,nickname,owner_id,created_at) VALUES(?,?,?,?,?)")
      .run(guild.id, target.id, target.nickname, actor.id, Date.now());
    recordSysPlusAudit(guild.id, actor.id, "lockname.protect", target.id);
    await logLockname(guild, settingsFor(rawSettings, guild.id), "🔒 LOCKNAME — pseudonyme protégé", `Acteur : <@${actor.id}>\nMembre : <@${target.id}>`).catch(() => {});
    return `🔒 Le pseudonyme actuel de **${target.displayName}** est maintenant protégé.`;
  }

  const existing = db.prepare("SELECT 1 FROM protected_nicknames WHERE guild_id=? AND member_id=?").get(guild.id, target.id);
  if (!existing) throw new Error("Ce membre n’a pas de pseudonyme protégé.");
  db.prepare("DELETE FROM protected_nicknames WHERE guild_id=? AND member_id=?").run(guild.id, target.id);
  recordSysPlusAudit(guild.id, actor.id, "lockname.remove", target.id);
  await logLockname(guild, settingsFor(rawSettings, guild.id), "🔓 LOCKNAME — protection retirée", `Acteur : <@${actor.id}>\nMembre : <@${target.id}>`).catch(() => {});
  return `🔓 La protection du pseudonyme de **${target.displayName}** est désactivée.`;
}

function listProtected(guildId) {
  const rows = db.prepare("SELECT member_id,nickname,created_at FROM protected_nicknames WHERE guild_id=? ORDER BY created_at DESC LIMIT 20").all(guildId);
  if (!rows.length) return "Aucun pseudonyme protégé sur ce serveur.";
  return rows.map((row) => `• <@${row.member_id}> — **${String(row.nickname ?? "nom de compte").slice(0, 80)}**`).join("\n");
}

export async function enforceProtectedNickname(member, rawSettings = null) {
  if (!member?.guild || member.user?.bot) return false;
  const row = db.prepare("SELECT nickname FROM protected_nicknames WHERE guild_id=? AND member_id=?").get(member.guild.id, member.id);
  if (!row) return false;
  const restore = protectedNicknameRestore(member.nickname, row.nickname);
  if (!restore.shouldRestore) return false;
  const bot = await member.guild.members.fetchMe();
  if (!bot.permissions.has(PermissionFlagsBits.ManageNicknames) || member.roles.highest.position >= bot.roles.highest.position) return false;
  await member.setNickname(restore.nickname, "LOCKNAME : restauration du pseudonyme protégé");
  recordSysPlusAudit(member.guild.id, member.guild.client.user.id, "lockname.restore", member.id, { changed: true });
  await logLockname(member.guild, settingsFor(rawSettings, member.guild.id), "🛡️ LOCKNAME — pseudonyme restauré", `Membre : <@${member.id}>`).catch(() => {});
  return true;
}

export async function reconcileProtectedNicknames(client, rawSettings = null) {
  const rows = db.prepare("SELECT guild_id,member_id FROM protected_nicknames ORDER BY guild_id,member_id").all();
  let restored = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;
    const member = await guild.members.fetch({ user: row.member_id, force: true }).catch(() => null);
    if (member && await enforceProtectedNickname(member, rawSettings).catch(() => false)) restored++;
  }
  return restored;
}

export async function handleLocknameMessage(message, rawSettings) {
  if (!message.guild || !message.member) return false;
  const command = message.content.trim().split(/\s+/)[0]?.toLowerCase();
  if (!command) return false;
  const action = command === "=lockname" ? "protect" : command === "=unlockname" ? "remove" : null;
  if (!action && command !== "=locknamelist") return false;
  try {
    if (!action) {
      await requireOperator(message.guild, message.author.id, rawSettings);
      await message.reply({ content: listProtected(message.guild.id), allowedMentions: { parse: [] } });
      return true;
    }
    const targetId = targetIdFromMessage(message);
    if (!targetId) throw new Error(`Utilisation : ${command} @membre.`);
    const content = await changeLock(message.guild, message.author.id, targetId, action, rawSettings);
    await message.reply({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    await message.reply({ content: error.message, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

export async function handleLocknameInteraction(interaction, rawSettings) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "lockname") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Cette commande fonctionne uniquement dans un serveur.", ephemeral: true });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    // The catalogue names are French (proteger/retirer/liste); accept both so that
    // /lockname proteger never falls through to "remove" (former bug).
    const subcommand = ({ proteger: "protect", protéger: "protect", retirer: "remove", liste: "list" })[interaction.options.getSubcommand()] ?? interaction.options.getSubcommand();
    if (subcommand === "list") {
      await requireOperator(interaction.guild, interaction.user.id, rawSettings);
      await interaction.editReply(listProtected(interaction.guild.id));
      return true;
    }
    const target = interaction.options.getUser("membre", true);
    if (subcommand !== "protect" && subcommand !== "remove") throw new Error("Sous-commande LOCKNAME inconnue.");
    const action = subcommand;
    const content = await changeLock(interaction.guild, interaction.user.id, target.id, action, rawSettings);
    await interaction.editReply(content);
  } catch (error) {
    await interaction.editReply(error.message);
  }
  return true;
}
