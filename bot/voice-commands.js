import { RANK_SHIELD_MESSAGE, rankAllows } from "./owner-shield.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  UserSelectMenuBuilder,
} from "discord.js";
import { deleteVoiceLockSnapshot, getVoiceLockSnapshot, importLegacyVoiceLocks, listVoiceLockSnapshots, reconcileVoiceLocks, saveVoiceLockSnapshotIfAbsent } from "./voice-lock-store.js";
import { db } from "./database.js";
import { canUseVoiceCommand, privateVoicePlan, restoreVoicePlan, voiceCommand } from "./voice-permissions.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";
import { canUseAdminPlusScope, getAdminPlusScope } from "./systems/sysplus/admin-plus-scopes.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { isMemberDogged } from "./dog-commands.js";
import { systemLogEmbed, sendCentralLog } from "./logs.js";
import { herBotAvatar, themePanelEmbed } from "./theme.js";
import { isMenotteExpired, parseMenotteDuration } from "./menotte-policy.js";
import { evaluateTargetHierarchy } from "./target-hierarchy-policy.js";
import { claimWakeup, eligibleWakeupChannels, formatWakeupSummary, normalizeWakeupConfig, runWakeupSequence, sanitizeWakeupMessage } from "./wakeup.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { deactivatePrivateVoiceChannel, handleVoiceAccessRequestInteraction, handleVoiceAccessRequestMessage, publishVoiceAccessEntryPoint, registerPrivateVoiceChannel } from "./voice-access-requests.js";
import { handleVoicePresenceMessage } from "./voice-audit.js";
import { withVoiceChannelLock } from "./voice-channel-lock.js";
import { handleAntiMoveMessage } from "./anti-move.js";

const enforcingMenottes = new Set();
// PV/UNPV snapshots now live in SQLite (voice-lock-store.js). The legacy
// data/voice-locks.json file is imported once, then kept as a renamed backup.
let legacyImported = false;
function ensureLegacyImport() {
  if (legacyImported) return;
  legacyImported = true;
  try { importLegacyVoiceLocks(); } catch (error) { console.error("Import voice-locks.json :", error.message); }
}

function normalizeSettings(value) {
  if (value && ("voiceAccess" in value || "sysPlus" in value || "adminPlus" in value)) return value;
  return { voiceAccess: value ?? null };
}

function configuredAdminPlusRoleId(guildId, settings) {
  return settings?.adminPlus?.roleId ?? getAdminPlusRoleId(guildId);
}

function permittedAdminPlusRoleId(guildId, member, settings, scope = "voice") {
  const roleId = configuredAdminPlusRoleId(guildId, settings);
  return canUseAdminPlusScope(member, settings?.sysPlus?.roleId ?? null, roleId, scope, getAdminPlusScope(guildId, scope)) ? roleId : null;
}

const serialOverwrites = (channel) => [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
  id: overwrite.id,
  type: overwrite.type,
  allow: overwrite.allow.bitfield.toString(),
  deny: overwrite.deny.bitfield.toString(),
}));

async function resolveOverwriteTarget(guild, overwrite) {
  if (overwrite.type === 0) {
    return guild.roles.cache.get(overwrite.id) ?? await guild.roles.fetch(overwrite.id).catch(() => null);
  }
  return guild.members.cache.get(overwrite.id) ?? await guild.members.fetch(overwrite.id).catch(() => null);
}

async function apply(channel, plan) {
  for (const target of plan) {
    const resolved = await resolveOverwriteTarget(channel.guild, target);
    if (!resolved) continue;
    await channel.permissionOverwrites.edit(
      resolved,
      { Connect: target.Connect },
      "Configuration des accès vocaux",
    );
  }
}

async function lock(channel, member, bot, sysPlusRoleId = null) {
  ensureLegacyImport();
  const tempOwner = db.prepare("SELECT owner_id FROM temp_voice WHERE guild_id=? AND channel_id=?").get(channel.guild.id, channel.id);
  const ownerId = tempOwner?.owner_id ?? member.id;
  // Snapshot BEFORE any overwrite edit; the first snapshot always wins.
  saveVoiceLockSnapshotIfAbsent({ guildId: channel.guild.id, channelId: channel.id, ownerId, overwrites: serialOverwrites(channel) });
  await apply(channel, privateVoicePlan(serialOverwrites(channel), channel.guild.id, ownerId, bot?.user?.id ?? bot?.id, { sysPlusRoleId, pndOwnerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) }));
  registerPrivateVoiceChannel({
    guildId: channel.guild.id,
    channelId: channel.id,
    ownerUserId: ownerId,
    source: tempOwner ? "temp_voice" : "pv",
  });
  await publishVoiceAccessEntryPoint(channel, bot);
}

async function unlock(channel) {
  ensureLegacyImport();
  const snapshot = getVoiceLockSnapshot(channel.id);
  if (!snapshot) {
    // Compatibility for channels locked by the previous /voc lock handler,
    // which only denied @everyone and did not persist an overwrite snapshot.
    await channel.permissionOverwrites.edit(
      channel.guild.roles.everyone,
      { Connect: null },
      "Déverrouillage compatible ancien /voc lock",
    );
    deactivatePrivateVoiceChannel({ guildId: channel.guild.id, channelId: channel.id });
    return;
  }
  if (snapshot.guildId !== channel.guild.id) throw new Error("Ce salon n’a pas été verrouillé par le bot sur ce serveur.");
  await apply(channel, restoreVoicePlan(serialOverwrites(channel), snapshot.overwrites));
  deactivatePrivateVoiceChannel({ guildId: channel.guild.id, channelId: channel.id });
  deleteVoiceLockSnapshot(channel.id);
}

// Shared entry points used by both prefix commands and /voc lock|unlock.
// Keeping one implementation preserves overwrite snapshots and the Voice
// Access registry regardless of how the owner invokes the action.
export async function lockPrivateVoiceChannel(channel, member, bot, sysPlusRoleId = null) {
  return withVoiceChannelLock(channel.id, () => lock(channel, member, bot, sysPlusRoleId));
}

export async function unlockPrivateVoiceChannel(channel) {
  return withVoiceChannelLock(channel.id, () => unlock(channel));
}

async function authorizedChannel(guild, memberId, expectedChannelId, command, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const member = await guild.members.fetch({ user: memberId, force: true });
  const channelId = member.voice.channelId;
  if (!channelId || (expectedChannelId && channelId !== expectedChannelId)) {
    throw new Error("Rejoins le salon vocal concerné avant cette action.");
  }
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error("Cette commande demande un salon vocal classique.");
  }
  const adminPlusRoleId = permittedAdminPlusRoleId(guild.id, member, settings);
  if (!canUseVoiceCommand(
    command,
    channel.permissionsFor(member)?.bitfield ?? 0n,
    [...member.roles.cache.keys()],
    settings.voiceAccess,
    guild.ownerId === memberId,
    adminPlusRoleId,
    settings.sysPlus?.roleId ?? null,
  )) {
    throw new Error(`Tu n’as pas accès à ${command}. Vérifie les rôles autorisés dans le panneau Admin.`);
  }

  const bot = await guild.members.fetchMe();
  const botPermissions = channel.permissionsFor(bot);
  if (command === "=access" || command === "=unaccess" || command === "=pv" || command === "=unpv") {
    // Editing channel permission overwrites requires Manage Roles. Manage Channels
    // is not required and used to cause valid =pv requests to fail.
    if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error("Le bot doit avoir « Gérer les rôles » dans ce vocal pour modifier les accès.");
    }
  } else if (command === "=panel") {
    if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error("Le bot doit pouvoir envoyer des messages dans ce salon pour publier le panneau.");
    }
  }
  return { channel, member, bot, settings };
}

function panelPayload(channel, panelId) {
  return {
    embeds: [themePanelEmbed(new EmbedBuilder()
      .setTitle(`🌙 Vocal · ${channel.name}`)
      .setDescription("Panneau de contrôle des accès vocaux.")
      .addFields({ name: "Privé", value: "Les membres sans accès ne peuvent plus rejoindre. Les administrateurs Discord et le propriétaire restent soumis aux règles natives de Discord." }), { thumbnailUrl: channel.guild.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`voice:${panelId}:lock`).setLabel("Privatiser").setEmoji("🔒").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`voice:${panelId}:unlock`).setLabel("Rétablir l’accès").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`voice:${panelId}:allow`).setPlaceholder("Autoriser une personne").setMinValues(1).setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`voice:${panelId}:block`).setPlaceholder("Bloquer une personne").setMinValues(1).setMaxValues(1),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function parseTargetId(message, parts) {
  return message.mentions.members.first()?.id
    ?? parts[1]?.match(/^<@!?(\d{5,25})>$/)?.[1]
    ?? (parts[1] && /^\d{5,25}$/.test(parts[1]) ? parts[1] : null);
}

function auditMenotte(guildId, actorId, action, targetId, channelId) {
  recordSysPlusAudit(guildId, actorId, `voice.${action}`, targetId, { channelId });
}

async function handleMenotteMessage(message, command, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const member = await message.guild.members.fetch({ user: message.author.id, force: true }).catch(() => null);
  if (!member) throw new Error("Impossible de retrouver ton membre Discord.");
  const sysPlusRoleId = settings.sysPlus?.roleId ?? null;
  const adminPlusRoleId = configuredAdminPlusRoleId(message.guild.id, settings);
  if (!canUseAdminPlusScope(member, sysPlusRoleId, adminPlusRoleId, "voice", getAdminPlusScope(message.guild.id, "voice"))) {
    throw new Error("⛔ MENOTTE est réservé à l’OWNER et aux membres ADMIN+ dont le scope vocal est activé (/sysp permissions-edit). Le rôle SYS+ seul ne suffit pas.");
  }

  const parts = message.content.trim().split(/\s+/);
  const targetId = parseTargetId(message, parts);
  if (!targetId) throw new Error(`Utilisation : \`${command} @membre\`.`);
  const target = await message.guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!target) throw new Error("Je ne trouve pas ce membre sur le serveur.");
  if (target.user.bot) throw new Error("Tu ne peux pas menotter cette personne.");

  const bot = await message.guild.members.fetchMe();
  const actorIsSysPlus = isSysPlus(member, sysPlusRoleId);
  // Applying MENOTTE requires outranking the target for everyone (SYS+ included); only the
  // read/release commands keep the historical ADMIN+-only rank rule. Checked before any mutation.
  const hierarchy = evaluateTargetHierarchy({
    actor: member,
    target,
    bot,
    guildOwnerId: message.guild.ownerId,
    pndOwnerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID),
    enforceActorRank: command === "=menotte" || !actorIsSysPlus,
  });
  if (!hierarchy.allowed) throw new Error(hierarchy.reason);

  if (command === "=menotteinfo") {
    const row = db.prepare("SELECT channel_id, owner_id, created_at, expires_at FROM voice_menottes WHERE guild_id=? AND member_id=?").get(message.guild.id, target.id);
    const expiry = row?.expires_at ? `\nExpiration : <t:${Math.floor(row.expires_at / 1000)}:R>.` : "\nDurée : indéterminée.";
    await message.reply({
      content: row
        ? `🔒 **${target.displayName}** est menotté dans <#${row.channel_id}> depuis <t:${Math.floor(row.created_at / 1000)}:R>. Responsable : <@${row.owner_id}>.${expiry}`
        : `🔓 **${target.displayName}** n'est pas menotté.`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (command === "=unmenotte") {
    const row = db.prepare("SELECT channel_id, owner_id FROM voice_menottes WHERE guild_id=? AND member_id=?").get(message.guild.id, target.id);
    if (!row) throw new Error("Ce membre n'est pas menotté.");
    db.prepare("DELETE FROM voice_menottes WHERE guild_id=? AND member_id=?").run(message.guild.id, target.id);
    auditMenotte(message.guild.id, message.author.id, "unmenotte", target.id, row.channel_id);
    await sendCentralLog(message.guild, normalizeSettings(rawSettings), systemLogEmbed({ category: "dog", title: "🔓 MENOTTE — membre libéré", description: `Acteur : <@${message.author.id}>\nCible : <@${target.id}>` })).catch(() => {});
    await message.reply({ content: `🔓 **${target.displayName}** est libéré.`, allowedMentions: { parse: [] } });
    return true;
  }

  const voiceChannel = member.voice.channel;
  const durationMs = parseMenotteDuration(parts[2]);
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    throw new Error("Tu dois être dans un salon vocal classique pour utiliser =menotte.");
  }
  if (await isMemberDogged(message.guild.id, target.id)) {
    throw new Error("Ce membre est déjà soumis à DOG. Retire d'abord la laisse pour éviter les conflits de déplacement.");
  }
  const existing = db.prepare("SELECT channel_id FROM voice_menottes WHERE guild_id=? AND member_id=?").get(message.guild.id, target.id);
  if (existing) throw new Error(`Ce membre est déjà menotté dans <#${existing.channel_id}>. Utilise =unmenotte pour le libérer.`);
  if (!bot.permissions.has(PermissionFlagsBits.MoveMembers)) {
    throw new Error("Le bot doit avoir la permission « Déplacer les membres ».");
  }
  const destinationPermissions = voiceChannel.permissionsFor(bot);
  if (!destinationPermissions?.has(PermissionFlagsBits.Connect)) {
    throw new Error("Le bot ne peut pas rejoindre le salon vocal de destination.");
  }
  if (target.voice.channel) {
    const sourcePermissions = target.voice.channel.permissionsFor(bot);
    if (!sourcePermissions?.has(PermissionFlagsBits.MoveMembers)) {
      throw new Error("Le bot doit avoir « Déplacer les membres » dans le salon vocal actuel du membre.");
    }
  }

  const createdAt = Date.now();
  const expiresAt = durationMs == null ? null : createdAt + durationMs;
  db.prepare(`INSERT INTO voice_menottes(guild_id,member_id,channel_id,owner_id,created_at,expires_at)
    VALUES(?,?,?,?,?,?)`).run(message.guild.id, target.id, voiceChannel.id, member.id, createdAt, expiresAt);
  try {
    if (target.voice.channelId && target.voice.channelId !== voiceChannel.id) {
      await target.voice.setChannel(voiceChannel, `MENOTTE par ${message.author.tag}`);
    }
  } catch (error) {
    db.prepare("DELETE FROM voice_menottes WHERE guild_id=? AND member_id=?").run(message.guild.id, target.id);
    throw new Error(`Je n'ai pas réussi à déplacer ce membre : ${error.message}`);
  }
  auditMenotte(message.guild.id, message.author.id, "menotte", target.id, voiceChannel.id);
  await sendCentralLog(message.guild, normalizeSettings(rawSettings), systemLogEmbed({ category: "dog", title: "🔒 MENOTTE — membre immobilisé", description: `Acteur : <@${message.author.id}>\nCible : <@${target.id}>\nSalon : <#${voiceChannel.id}>` })).catch(() => {});
  await message.reply({
    content: `🔒 **${target.displayName}** est menotté au salon <#${voiceChannel.id}>${expiresAt ? ` jusqu’à <t:${Math.floor(expiresAt / 1000)}:R>` : " sans limite de durée"}. S'il le quitte ou le rejoint plus tard, le bot le ramènera ici.`,
    allowedMentions: { parse: [] },
  });
  return true;
}

async function enforceMenotteMember(guild, memberId) {
  const id = `${guild.id}:${memberId}`;
  if (enforcingMenottes.has(id)) return false;
  enforcingMenottes.add(id);
  try {
    const row = db.prepare("SELECT channel_id,expires_at FROM voice_menottes WHERE guild_id=? AND member_id=?").get(guild.id, memberId);
    if (!row) return false;
    if (isMenotteExpired(row.expires_at)) return false;
    const destination = await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!destination || destination.type !== ChannelType.GuildVoice) {
      db.prepare("DELETE FROM voice_menottes WHERE guild_id=? AND member_id=?").run(guild.id, memberId);
      return false;
    }
    const target = await guild.members.fetch(memberId).catch(() => null);
    if (!target?.voice?.channelId || target.voice.channelId === destination.id) return false;
    const bot = await guild.members.fetchMe();
    const sourcePermissions = target.voice.channel?.permissionsFor(bot);
    const destinationPermissions = destination.permissionsFor(bot);
    if (!bot.permissions.has(PermissionFlagsBits.MoveMembers)
      || !sourcePermissions?.has(PermissionFlagsBits.MoveMembers)
      || !destinationPermissions?.has(PermissionFlagsBits.Connect)) return false;
    await target.voice.setChannel(destination, "MENOTTE : retour au salon d'origine");
    return true;
  } catch {
    return false;
  } finally {
    enforcingMenottes.delete(id);
  }
}

export async function handleMenotteVoiceState(oldState, newState) {
  if (oldState.channelId === newState.channelId || !newState.guild) return false;
  return enforceMenotteMember(newState.guild, newState.id);
}

export async function expireVoiceMenottes(client, settingsByGuild = {}) {
  const now = Date.now();
  const rows = db.prepare("SELECT guild_id,member_id,channel_id FROM voice_menottes WHERE expires_at IS NOT NULL AND expires_at<=? ORDER BY expires_at").all(now);
  let expired = 0;
  for (const row of rows) {
    const result = db.prepare("DELETE FROM voice_menottes WHERE guild_id=? AND member_id=? AND expires_at IS NOT NULL AND expires_at<=?")
      .run(row.guild_id, row.member_id, now);
    if (!result.changes) continue;
    const guild = client.guilds.cache.get(row.guild_id);
    const actorId = client.user?.id;
    if (actorId) auditMenotte(row.guild_id, actorId, "menotte.expire", row.member_id, row.channel_id);
    if (guild) {
      await sendCentralLog(guild, normalizeSettings(settingsByGuild[row.guild_id]), systemLogEmbed({
        category: "dog",
        title: "⌛ MENOTTE — durée écoulée",
        description: `Membre libéré automatiquement : <@${row.member_id}>\nSalon d’origine : <#${row.channel_id}>`,
      })).catch(() => {});
    }
    expired++;
  }
  return expired;
}

export async function reconcileVoiceMenottes(client, settingsByGuild = {}) {
  await expireVoiceMenottes(client, settingsByGuild);
  const rows = db.prepare("SELECT DISTINCT guild_id, member_id FROM voice_menottes").all();
  let restored = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (guild && await enforceMenotteMember(guild, row.member_id)) restored++;
  }
  return restored;
}

export function forgetVoicePanels(channelId) {
  if (!channelId) return;
  db.prepare("DELETE FROM voice_panels WHERE channel_id=?").run(channelId);
  db.prepare("DELETE FROM voice_menottes WHERE channel_id=?").run(channelId);
  try {
    const snapshot = getVoiceLockSnapshot(channelId);
    if (snapshot) {
      deleteVoiceLockSnapshot(channelId);
      deactivatePrivateVoiceChannel({ guildId: snapshot.guildId, channelId });
    }
  } catch { /* best effort on channel deletion */ }
}

/** Restores PV state after a restart; see voice-lock-store.js. */
export async function reconcilePrivateVoiceLocks(client, options = {}) {
  ensureLegacyImport();
  return reconcileVoiceLocks(client, {
    ...options,
    onDeleted: (snapshot) => deactivatePrivateVoiceChannel({ guildId: snapshot.guildId, channelId: snapshot.channelId }),
  });
}

export function listPrivateVoiceLocks(guildId) {
  ensureLegacyImport();
  return listVoiceLockSnapshots(guildId);
}

/**
 * Validates a WAKEUP request and selects the channels. Nothing is mutated here:
 * every refusal (permissions, absent target, self-target...) happens before the
 * first move. The returned claim must be released by runWakeup().
 */
async function prepareWakeup(guild, actorId, targetId, announcement, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const actor = await guild.members.fetch({ user: actorId, force: true }).catch(() => null);
  if (!actor) throw new Error("Impossible de retrouver ton membre Discord.");
  const bot = await guild.members.fetchMe({ force: true });
  const sysPlusRoleId = settings?.sysPlus?.roleId ?? null;
  const adminPlusRoleId = configuredAdminPlusRoleId(guild.id, settings);
  if (!canUseAdminPlusScope(actor, sysPlusRoleId, adminPlusRoleId, "voice", getAdminPlusScope(guild.id, "voice"))) {
    throw new Error("⛔ WAKEUP est réservé à l’OWNER et aux membres ADMIN+ dont le scope vocal est activé (/sysp permissions-edit). Le rôle SYS+ seul ne suffit pas.");
  }
  if (!actor.permissions.has(PermissionFlagsBits.MoveMembers) && !actor.permissions.has(PermissionFlagsBits.Administrator) && guild.ownerId !== actorId) {
    throw new Error("La permission Discord « Déplacer des membres » est requise pour WAKEUP.");
  }
  if (!bot.permissions.has(PermissionFlagsBits.MoveMembers)) throw new Error("Je dois avoir la permission Déplacer des membres.");
  const target = await guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!target) throw new Error("Cette personne n’est pas membre du serveur.");
  if (target.id === actor.id) throw new Error("Tu ne peux pas utiliser WAKEUP sur toi-même.");
  if (target.user?.bot) throw new Error("WAKEUP ne s’applique pas aux bots.");
  if (!target.voice?.channelId) throw new Error("Ce membre n’est dans aucun salon vocal.");
  if (!isSysPlus(actor, sysPlusRoleId) && target.roles.highest.position >= actor.roles.highest.position) {
    throw new Error("ADMIN+ ne peut déplacer que les membres dont le rôle le plus élevé est inférieur au sien.");
  }
  const channels = eligibleWakeupChannels({ guild, target, bot, config: normalizeWakeupConfig(settings) });
  if (!channels.length) throw new Error("Aucun salon vocal public éligible : rien n’a été déplacé. Un salon compte s’il est ouvert à @everyone ou au rôle des membres (rôle de vérification ou rôle automatique), et si le bot peut y déplacer des membres.");
  const claim = claimWakeup(guild.id, actorId, target.id);
  if (!claim.ok) throw new Error(claim.reason);
  return { guild, actor, target, settings, channels, announcement: sanitizeWakeupMessage(announcement), claim };
}

/** Runs the sequence, always releases the claim, then audits and logs one summary entry. */
async function runWakeup(prepared, { dryRun = false } = {}) {
  const { guild, actor, target, settings, channels, announcement, claim } = prepared;
  let summary;
  try {
    summary = await runWakeupSequence({ target, actorId: actor.id, channels, announcement, reason: `WAKEUP demandé par ${actor.id}`, dryRun });
    // Simulation (=wakeup test) : rien n'est déplacé, le délai de recharge n'est pas consommé.
    if (dryRun) { claim.release(0); return summary; }
  } catch (error) {
    summary = { total: channels.length, visited: 0, failures: [{ channel: "séquence", reason: error instanceof Error ? error.message.slice(0, 120) : "erreur inattendue" }], dmFailed: 0, stopped: null };
  } finally {
    claim.release();
  }
  try {
    recordSysPlusAudit(guild.id, actor.id, "voice.wakeup", target.id, { visited: summary.visited, total: summary.total, failed: summary.failures.length });
  } catch (error) {
    console.error("WAKEUP audit failed:", error.message);
  }
  await sendCentralLog(guild, settings, systemLogEmbed({
    category: "voice",
    title: "⏰ WAKEUP — séquence terminée",
    description: `Acteur : <@${actor.id}>\nMembre : <@${target.id}>\nSalons visités : ${summary.visited}/${summary.total}\nÉchecs : ${summary.failures.length}${announcement ? `\nMessage : ${announcement}` : ""}`,
  })).catch(() => {});
  return summary;
}

export async function handleVoiceMessage(message, rawSettings) {
  const command = voiceCommand(message.content);
  if (!command) return false;
  if (!message.guild || !message.member) return true;

  try {
    if (command === "=anti-moove") {
      return await handleAntiMoveMessage(message, rawSettings);
    }
    if (command === "=demandevocal") {
      await handleVoiceAccessRequestMessage(message, normalizeSettings(rawSettings));
      return true;
    }
    if (command === "=vocalpresence") {
      return await handleVoicePresenceMessage(message);
    }
    if (command === "=menotte" || command === "=unmenotte" || command === "=menotteinfo") {
      return await handleMenotteMessage(message, command, rawSettings);
    }

    const settings = normalizeSettings(rawSettings);
    if (command === "=wakeup") {
      const target = message.mentions.members.first();
      const parts = message.content.trim().split(/\s+/);
      const dryRun = /^test$/i.test(parts[1] ?? "");
      if (dryRun) parts.splice(1, 1);
      const targetId = target?.id ?? parts[1]?.match(/^<@!?(\d{5,25})>$/)?.[1];
      if (!targetId) throw new Error("Utilisation : `=wakeup @membre [message]`.");
      const announcement = message.content.replace(/^=wakeup\s+(test\s+)?/i, "").replace(/<@!?\d+>/g, "").trim();
      const prepared = await prepareWakeup(message.guild, message.author.id, targetId, announcement, settings);
      if (dryRun) {
        const simulated = await runWakeup(prepared, { dryRun: true });
        await message.reply({ content: formatWakeupSummary(targetId, simulated), allowedMentions: { parse: [] } }).catch(() => {});
        return true;
      }
      // One reply only: it is edited with the final count, never followed by a second status message.
      const progress = await message.reply({ content: `⏰ WAKEUP en cours sur <@${targetId}>… (${prepared.channels.length} salon(s))`, allowedMentions: { parse: [] } }).catch(() => null);
      const summary = await runWakeup(prepared);
      await progress?.edit?.({ content: formatWakeupSummary(targetId, summary), allowedMentions: { parse: [] } }).catch((error) => console.error("WAKEUP summary edit failed:", error.message));
      return true;
    }
    if (command === "=pv" && /^(liste|list|statut)$/i.test(message.content.trim().split(/\s+/)[1] ?? "")) {
      const viewer = await message.guild.members.fetch({ user: message.author.id, force: true }).catch(() => null);
      if (!viewer || !canUseAdminPlusScope(viewer, settings.sysPlus?.roleId ?? null, configuredAdminPlusRoleId(message.guild.id, settings), "voice", getAdminPlusScope(message.guild.id, "voice"))) {
        throw new Error("⛔ La liste des salons privés est réservée au SYS+ et aux ADMIN+ autorisés sur le module vocal.");
      }
      const locks = listPrivateVoiceLocks(message.guild.id);
      const lines = locks.slice(0, 25).map((lock) => `• <#${lock.channelId}> — ${lock.ownerId ? `<@${lock.ownerId}>` : "responsable inconnu"} · depuis <t:${Math.floor(lock.createdAt / 1000)}:R>`);
      await message.reply({ content: locks.length ? `🔒 **Salons privatisés (${locks.length})**\n${lines.join("\n")}${locks.length > 25 ? `\n… et ${locks.length - 25} autre(s).` : ""}` : "🔓 Aucun salon privatisé par le bot sur ce serveur.", allowedMentions: { parse: [] } });
      return true;
    }
    const { channel, member, bot } = await authorizedChannel(message.guild, message.author.id, undefined, command, settings);
    if (command === "=access" || command === "=unaccess") {
      const parts = message.content.trim().split(/\s+/);
      const targetId = message.mentions.members.first()?.id ?? parts[1]?.match(/^<@!?([0-9]{5,25})>$/)?.[1];
      if (!targetId) throw new Error(`Utilisation : \`${command} @membre\` — rejoins d’abord le salon vocal concerné.`);
      const target = await message.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new Error("Je ne trouve pas ce membre sur le serveur.");
      if (target.id === bot.id) throw new Error("Le bot a déjà accès à ses salons vocaux.");
      if (command === "=access") {
        await channel.permissionOverwrites.edit(target, { Connect: true }, `Accès vocal accordé par ${message.author.tag} avec =access`);
        await message.reply({ content: `✅ <@${target.id}> peut maintenant rejoindre **${channel.name}**.`, allowedMentions: { users: [target.id] } });
      } else {
        await channel.permissionOverwrites.edit(target, { Connect: null }, `Accès vocal retiré par ${message.author.tag} avec =unaccess`);
        await message.reply({ content: `✅ L’accès individuel de <@${target.id}> à **${channel.name}** a été retiré.`, allowedMentions: { users: [target.id] } });
      }
    } else if (command === "=unpv") {
      await unlockPrivateVoiceChannel(channel);
      await message.reply({ content: `🔓 **${channel.name}** est de nouveau accessible : les permissions d’origine sont restaurées.`, allowedMentions: { parse: [] } });
    } else if (command === "=pv") {
      await withVoiceChannelLock(channel.id, () => lock(channel, member, bot, settings.sysPlus?.roleId ?? null));
      await message.reply({
        content: `🔒 **${channel.name}** est privé. Les membres sans accès ne peuvent plus rejoindre ; les administrateurs Discord et le propriétaire restent exemptés selon les règles Discord. Les personnes déjà présentes restent dans le vocal.`,
        allowedMentions: { parse: [] },
      });
    } else {
      const panelId = message.id;
      db.prepare(`INSERT INTO voice_panels(panel_id,guild_id,channel_id,created_by,created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(panel_id) DO UPDATE SET guild_id=excluded.guild_id, channel_id=excluded.channel_id, created_by=excluded.created_by, created_at=excluded.created_at`)
        .run(panelId, message.guild.id, channel.id, member.id, Date.now());
      await message.reply(panelPayload(channel, panelId));
    }
  } catch (error) {
    console.error("Commande vocale :", error.message);
    await message.reply({
      content: error.message.includes("Missing Permissions")
        ? "Discord refuse cette modification : vérifie les permissions du bot et sa hiérarchie."
        : error.message,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
  return true;
}

export async function handleVoiceInteraction(interaction, rawSettings) {
  if (interaction.isChatInputCommand?.() && interaction.commandName === "wakeup") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
      return true;
    }
    // Defer first, then edit that same reply with the outcome (refusal or final count).
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    try {
      const user = interaction.options.getUser("membre", true);
      const prepared = await prepareWakeup(interaction.guild, interaction.user.id, user.id, interaction.options.getString("message"), rawSettings);
      const summary = await runWakeup(prepared, { dryRun: interaction.options.getBoolean?.("test", false) === true });
      await interaction.editReply({ content: formatWakeupSummary(user.id, summary), allowedMentions: { parse: [] } });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "WAKEUP impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
    }
    return true;
  }
  if (await handleVoiceAccessRequestInteraction(interaction, normalizeSettings(rawSettings))) return true;
  if ((!interaction.isButton() && !interaction.isUserSelectMenu()) || !interaction.customId.startsWith("voice:")) return false;
  await interaction.deferReply({ flags: 64 });
  try {
    const [, panelId, action] = interaction.customId.split(":");
    const panel = db.prepare("SELECT guild_id,channel_id FROM voice_panels WHERE panel_id=?").get(panelId);
    if (!panel) throw new Error("Ce panneau n'existe plus ou son salon a été supprimé.");
    if (!interaction.guild || panel.guild_id !== interaction.guild.id) throw new Error("Ce panneau appartient à un autre serveur.");
    const settings = normalizeSettings(rawSettings);
    const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Le salon vocal associé à ce panneau est introuvable.");
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    const bot = await interaction.guild.members.fetchMe({ force: true });
    const adminPlusRoleId = permittedAdminPlusRoleId(interaction.guild.id, member, settings);
    const memberPermissions = channel.permissionsFor(member)?.bitfield ?? 0n;
    const roles = [...member.roles.cache.keys()];
    const sysPlusRoleId = settings.sysPlus?.roleId ?? null;
    const canUsePanel = canUseVoiceCommand("=panel", memberPermissions, roles, settings.voiceAccess, interaction.guild.ownerId === member.id, adminPlusRoleId, sysPlusRoleId);
    if (!canUsePanel) throw new Error("Tu n'as pas la permission d'utiliser ce panneau vocal.");
    const botPermissions = channel.permissionsFor(bot);
    if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error("Le bot doit avoir « Gérer les rôles » dans ce vocal pour modifier les accès.");
    }

    await withVoiceChannelLock(channel.id, async () => {
      if (action === "lock" || action === "unlock") {
        const canUsePv = canUseVoiceCommand("=pv", memberPermissions, roles, settings.voiceAccess, interaction.guild.ownerId === member.id, adminPlusRoleId, sysPlusRoleId);
        if (!canUsePv) throw new Error("Le verrouillage demande aussi l'accès à =pv.");
        if (action === "lock") await lock(channel, member, bot, sysPlusRoleId);
        else await unlock(channel);
      } else if ((action === "allow" || action === "block") && interaction.isUserSelectMenu()) {
        const targetId = interaction.values[0];
        if (!targetId) throw new Error("Choisis une personne.");
        const target = await interaction.guild.members.fetch(targetId);
        if (target.id === bot.id || target.id === member.id) throw new Error("Tu ne peux pas modifier ton propre accès ni celui du bot ici.");
        if (action === "block" && (target.id === interaction.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator))) {
          throw new Error("Discord ne permet pas de bloquer un administrateur ou le propriétaire du serveur.");
        }
        if (target.roles.highest.position >= bot.roles.highest.position) throw new Error("Je ne peux pas modifier ce membre à cause de la hiérarchie des rôles.");
        if (action === "block" && !rankAllows({ actorId: member.id, targetId: target.id, actorPosition: member.roles.highest.position, targetPosition: target.roles.highest.position, guildOwnerId: interaction.guild.ownerId })) {
          throw new Error(RANK_SHIELD_MESSAGE.replace(/^⛔ /, ""));
        }
        if (action === "block" && target.voice.channelId === channel.id && !botPermissions.has(PermissionFlagsBits.MoveMembers)) {
          throw new Error("Le bot doit avoir « Déplacer les membres » pour sortir cette personne du vocal.");
        }
        await channel.permissionOverwrites.edit(target, { Connect: action === "allow" }, `Accès vocal depuis le panneau par ${interaction.user.tag}`);
        if (action === "block" && target.voice.channelId === channel.id) await target.voice.disconnect("Bloqué depuis le panneau vocal");
      } else {
        throw new Error("Action inconnue.");
      }
    });
    await interaction.editReply({
      content: action === "allow" ? "✅ Accès autorisé."
        : action === "block" ? "✅ Personne bloquée."
          : action === "lock" ? "🔒 Vocal privatisé."
            : "🔓 Accès du vocal rétabli.",
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("Panneau vocal :", error.message);
    await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
