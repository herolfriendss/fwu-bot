// Her? V4 — Vocal V2 : hub « rejoindre pour créer » et salons temporaires.
//
// Chaque salon créé est enregistré dans SQLite avec son serveur et son
// propriétaire. Il est supprimé quand il n'y reste plus aucun humain (après
// le délai de grâce réglé dans /setup), ou manuellement par le propriétaire
// ou le staff. Quand le propriétaire part, la propriété passe au membre
// suivant. Le propriétaire garde ses listes (confiance / bloqués) et ses
// préférences (nom, limite) d'un salon à l'autre, serveur par serveur.
import { RANK_SHIELD_MESSAGE, rankAllows } from "./owner-shield.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder,
  OverwriteType, PermissionFlagsBits, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from "discord.js";
import { db } from "./database.js";
import {
  buildPanelId, canManageTempVoice, clampEmptyDeleteSeconds, clampVoiceLimit, listAddRefusal, listOverwritePlan,
  parsePanelId, pickNextOwner, renameAllowed, renderVoiceName, tempVoiceNameIsValid, MAX_LIST_ENTRIES,
} from "./voice-v2-policy.js";
import {
  allTempVoices, deleteGuildTempVoices, deleteTempVoice, getPrefs, getTempVoice, insertTempVoice, latestTempVoiceOf,
  listEntries, listEntry, listSize, putListEntry, removeListEntry, savePrefs, setTempVoiceOwner,
} from "./temp-voice-store.js";
import { themePanelEmbed } from "./theme.js";
import { deactivatePrivateVoiceChannel, handleVoiceAccessRequestMessage, registerPrivateVoiceChannel } from "./voice-access-requests.js";
import { handleVoiceMessage, lockPrivateVoiceChannel, unlockPrivateVoiceChannel } from "./voice-commands.js";
import { removeVoiceAccessBlock } from "./voice-access-store.js";
import { isTier0Protected } from "./tier0-shield.js";
import { ownerId as configuredOwnerId } from "./shared/tiers.js";

const P = PermissionFlagsBits;
// Pas de « Rendre muet » ni « Mettre en sourdine » : un mute serveur suit le
// membre dans tous les salons, ce serait un outil d'abus hors du salon.
const OWNER_ALLOW = [P.ViewChannel, P.Connect, P.Speak, P.ManageChannels, P.MoveMembers];
const OWNER_GRANT = { ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true };
const OWNER_REVOKE = { ManageChannels: null, MoveMembers: null, MuteMembers: null, DeafenMembers: null };

const creating = new Set(); // guildId:userId — un seul salon créé à la fois par membre
const pendingDeletes = new Map(); // channelId → timer du délai de grâce
const renameHistory = new Map(); // channelId → horodatages des derniers renommages

// ── Outils ──────────────────────────────────────────────────────────────────

/** null : le salon n'existe plus (10003). undefined : erreur passagère. */
async function fetchChannel(guild, channelId) {
  return guild.channels.fetch(channelId).catch((error) => (error?.code === 10003 ? null : undefined));
}

function humansIn(channel) {
  return [...(channel?.members?.values?.() ?? [])].filter((member) => !member.user?.bot);
}

function cancelPendingDelete(channelId) {
  const timer = pendingDeletes.get(channelId);
  if (timer) clearTimeout(timer);
  pendingDeletes.delete(channelId);
}

function forgetChannelState(channelId) {
  cancelPendingDelete(channelId);
  renameHistory.delete(channelId);
}

async function deleteTempChannel(channel, reason, record = () => {}) {
  forgetChannelState(channel.id);
  try {
    await channel.delete(reason);
  } catch (error) {
    if (error?.code !== 10003) { record("temp_voice_error"); return false; }
  }
  deleteTempVoice(channel.id);
  try { deactivatePrivateVoiceChannel({ guildId: channel.guild.id, channelId: channel.id }); } catch { /* pas verrouillé */ }
  return true;
}

/** Supprime le salon s'il est toujours vide, tout de suite ou après le délai de grâce. */
function scheduleEmptyDelete(guild, channelId, seconds, record) {
  cancelPendingDelete(channelId);
  const run = async () => {
    pendingDeletes.delete(channelId);
    if (!getTempVoice(channelId)) return false;
    const channel = await fetchChannel(guild, channelId);
    if (channel === null) { deleteTempVoice(channelId); return false; }
    if (!channel || humansIn(channel).length) return false;
    const deleted = await deleteTempChannel(channel, "Vocal V2 : salon temporaire vide", record);
    if (deleted) record("temp_voice_deleted");
    return deleted;
  };
  if (seconds <= 0) return run();
  const timer = setTimeout(() => { void run().catch(() => record("temp_voice_error")); }, seconds * 1000);
  timer.unref?.();
  pendingDeletes.set(channelId, timer);
  return Promise.resolve(true);
}

async function memberPosition(guild, id) {
  const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
  return member ? member.roles?.highest?.position ?? 0 : null;
}

/** Le propriétaire peut-il agir contre ce membre (rang, palier 0) ? */
async function targetRefusal(guild, actor, target) {
  if (!rankAllows({ actorId: actor.id, targetId: target.id, actorPosition: actor.roles.highest.position, targetPosition: target.roles.highest.position, guildOwnerId: guild.ownerId })) {
    return RANK_SHIELD_MESSAGE.replace(/^⛔ /, "");
  }
  if (actor.id !== configuredOwnerId() && await isTier0Protected(target).catch(() => false)) {
    return "Ce membre est intouchable : action refusée.";
  }
  return null;
}

/** Permissions issues des listes du propriétaire, pour les membres encore sur le serveur. */
async function listOverwrites(guild, ownerId) {
  const entries = listEntries(guild.id, ownerId);
  if (!entries.length) return [];
  const ownerPosition = await memberPosition(guild, ownerId);
  const positions = new Map();
  for (const entry of entries) positions.set(entry.targetId, await memberPosition(guild, entry.targetId));
  const present = entries.filter((entry) => positions.get(entry.targetId) !== null);
  const owner = configuredOwnerId();
  return listOverwritePlan(present, {
    outranksOwner: (id) => id === owner || id === guild.ownerId || (ownerPosition !== null && positions.get(id) >= ownerPosition),
  });
}

async function applyListOverwrites(channel, ownerId) {
  for (const item of await listOverwrites(channel.guild, ownerId)) {
    const { id, ...perms } = item;
    await channel.permissionOverwrites.edit(id, perms, { type: OverwriteType.Member, reason: "Vocal V2 : listes du propriétaire" }).catch(() => {});
  }
}

function isLocked(channel) {
  const everyone = channel.permissionOverwrites?.cache?.get(channel.guild.roles.everyone.id);
  return Boolean(everyone?.deny?.has?.(P.Connect));
}

// ── Panneau de contrôle ─────────────────────────────────────────────────────

function button(action, channelId, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(buildPanelId(action, channelId)).setLabel(label).setEmoji(emoji).setStyle(style);
}

export function controlPanelComponents(channelId) {
  return [
    new ActionRowBuilder().addComponents(
      button("lock", channelId, "Verrouiller", "🔒"),
      button("unlock", channelId, "Déverrouiller", "🔓"),
      button("limit", channelId, "Limite", "👥"),
      button("name", channelId, "Renommer", "✏️"),
      button("info", channelId, "Infos", "ℹ️"),
    ),
    new ActionRowBuilder().addComponents(
      button("invite", channelId, "Inviter", "✅", ButtonStyle.Success),
      button("kick", channelId, "Expulser", "👢"),
      button("transfer", channelId, "Transférer", "👑"),
      button("claim", channelId, "Revendiquer", "🙋"),
      button("delete", channelId, "Supprimer", "🗑️", ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      button("trust", channelId, "Confiance", "⭐"),
      button("block", channelId, "Bloquer", "⛔"),
      button("unlist", channelId, "Retirer d'une liste", "↩️"),
    ),
  ];
}

function infoEmbed(guild, channel, row) {
  const trusted = listEntries(guild.id, row.owner_id).filter((e) => e.kind === "trusted").length;
  const blocked = listEntries(guild.id, row.owner_id).filter((e) => e.kind === "blocked").length;
  return themePanelEmbed(new EmbedBuilder()
    .setTitle("🌙 Salon vocal temporaire")
    .setDescription("Le propriétaire (ou le staff) gère le salon avec les boutons ci-dessous ou `/voc`. Si le propriétaire part, la propriété passe au membre suivant.")
    .addFields(
      { name: "Salon", value: `<#${channel.id}>`, inline: true },
      { name: "Propriétaire", value: `<@${row.owner_id}>`, inline: true },
      { name: "Limite", value: channel.userLimit ? `${channel.userLimit} membre(s)` : "Illimitée", inline: true },
      { name: "Accès", value: isLocked(channel) ? "🔒 Verrouillé (demandes d'accès)" : "🔓 Ouvert", inline: true },
      { name: "Listes du propriétaire", value: `⭐ ${trusted} de confiance · ⛔ ${blocked} bloqué(s)`, inline: true },
    ), { animated: false, thumbnailUrl: guild.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) });
}

async function postControlPanel(channel, row) {
  if (typeof channel.send !== "function") return;
  await channel.send({
    content: `<@${row.owner_id}>, voici le panneau de ton salon.`,
    embeds: [infoEmbed(channel.guild, channel, row)],
    components: controlPanelComponents(channel.id),
    allowedMentions: { users: [row.owner_id] },
  }).catch(() => {});
}

// ── Création, départ, transfert ─────────────────────────────────────────────

async function transferOwnership(channel, previousOwnerId, nextOwnerId, reason) {
  setTempVoiceOwner(channel.id, nextOwnerId);
  await channel.permissionOverwrites.edit(previousOwnerId, OWNER_REVOKE, { type: OverwriteType.Member, reason }).catch(() => {});
  await channel.permissionOverwrites.edit(nextOwnerId, OWNER_GRANT, { type: OverwriteType.Member, reason }).catch(() => {});
  // Salon verrouillé : les demandes d'accès vont désormais au nouveau propriétaire.
  const active = db.prepare("SELECT active FROM voice_private_channels WHERE guild_id=? AND channel_id=?").get(channel.guild.id, channel.id);
  if (active?.active) {
    try { registerPrivateVoiceChannel({ guildId: channel.guild.id, channelId: channel.id, ownerUserId: nextOwnerId, source: "temp_voice" }); } catch { /* ids invalides en test */ }
  }
  renameHistory.delete(channel.id);
}

async function createForMember(guild, member, config, record) {
  const key = `${guild.id}:${member.id}`;
  if (creating.has(key)) return false;
  creating.add(key);
  try {
    const existing = latestTempVoiceOf(guild.id, member.id);
    if (existing) {
      const channel = await fetchChannel(guild, existing.channel_id);
      if (channel) {
        cancelPendingDelete(channel.id);
        await member.voice.setChannel(channel, "Vocal V2 : retour dans le salon personnel").catch(() => {});
        return true;
      }
      if (channel === undefined) return false; // Discord indisponible : ne rien créer en double
      deleteTempVoice(existing.channel_id);
    }
    const prefs = getPrefs(guild.id, member.id);
    const hub = guild.channels.cache.get(config.hubChannelId);
    const me = guild.members.me?.id ?? guild.client.user.id;
    const lists = await listOverwrites(guild, member.id);
    const channel = await guild.channels.create({
      name: prefs?.name ?? renderVoiceName(config.nameTemplate, member.displayName),
      type: ChannelType.GuildVoice,
      parent: config.categoryId ?? hub?.parentId ?? undefined,
      userLimit: prefs?.limit ?? clampVoiceLimit(config.defaultLimit),
      permissionOverwrites: [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, allow: [P.Connect, P.Speak] },
        ...lists.map(({ id, Connect, ViewChannel }) => ({
          id, type: OverwriteType.Member,
          allow: [...(Connect ? [P.Connect] : []), ...(ViewChannel ? [P.ViewChannel] : [])],
          deny: Connect ? [] : [P.Connect],
        })),
        { id: member.id, type: OverwriteType.Member, allow: OWNER_ALLOW },
        { id: me, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.Speak, P.ManageChannels, P.MoveMembers] },
      ],
      reason: `Vocal V2 : salon de ${member.user.tag}`,
    });
    insertTempVoice({ channelId: channel.id, guildId: guild.id, ownerId: member.id });
    const moved = await member.voice.setChannel(channel, "Vocal V2 : salon personnel").then(() => true, () => false);
    if (!moved && !humansIn(channel).length) {
      // Le membre a quitté le hub avant le déplacement : pas de salon fantôme.
      await deleteTempChannel(channel, "Vocal V2 : membre parti avant le déplacement", record);
      return false;
    }
    void postControlPanel(channel, { owner_id: member.id });
    record("temp_voice_created");
    return true;
  } catch {
    record("temp_voice_error");
    return false;
  } finally {
    creating.delete(key);
  }
}

async function handleTempLeave(guild, channelId, leaverId, config, record) {
  const row = getTempVoice(channelId);
  if (!row) return false;
  const channel = await fetchChannel(guild, channelId);
  if (channel === null) { deleteTempVoice(channelId); return false; }
  if (!channel) return false;
  const humans = humansIn(channel);
  if (!humans.length) {
    await scheduleEmptyDelete(guild, channelId, clampEmptyDeleteSeconds(config?.emptyDeleteSeconds), record);
    return true;
  }
  if (row.owner_id === leaverId) {
    const nextOwnerId = pickNextOwner(humans.map((m) => ({ id: m.id, bot: false })), row.owner_id);
    if (nextOwnerId) {
      await transferOwnership(channel, row.owner_id, nextOwnerId, "Vocal V2 : le propriétaire est parti");
      await channel.send?.({ content: `👑 <@${nextOwnerId}> devient propriétaire du salon (l'ancien propriétaire est parti).`, allowedMentions: { users: [nextOwnerId] } }).catch(() => {});
      record("temp_voice_transferred");
      return true;
    }
  }
  return false;
}

export async function handleVoiceV2State(oldState, newState, settings, record = () => {}) {
  const guild = newState.guild ?? oldState.guild;
  if (!guild) return false;
  const config = settings?.tempVoice;
  const moved = oldState.channelId !== newState.channelId;
  let handled = false;

  // Quelqu'un rejoint un salon temporaire : il ne doit plus être supprimé.
  if (moved && newState.channelId) cancelPendingDelete(newState.channelId);

  // 1. Départ d'un salon temporaire (y compris vers le hub) : transfert ou nettoyage.
  if (moved && oldState.channelId) {
    try {
      handled = await handleTempLeave(guild, oldState.channelId, oldState.id, config, record);
    } catch {
      record("temp_voice_error");
    }
  }

  // 2. Arrivée dans le hub : création (ou retour dans) le salon personnel.
  if (config?.enabled && config.hubChannelId && moved && newState.channelId === config.hubChannelId && newState.member && !newState.member.user.bot) {
    handled = (await createForMember(guild, newState.member, config, record)) || handled;
  }
  return handled;
}

/** Réconcilie les salons temporaires persistés après un redémarrage.
 * Les lignes orphelines sont supprimées, les salons vidés pendant l'arrêt sont
 * supprimés, et les membres restés dans le hub reçoivent leur salon.
 */
export async function reconcileTempVoices(client, record = () => {}, settings = null) {
  const rows = allTempVoices();
  let removed = 0;
  let emptiedDeleted = 0;
  let created = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue; // serveur momentanément indisponible : conserver la ligne
    // Only "Unknown Channel" (10003) proves deletion; any other error is transient
    // and must not drop the row (the channel would then stay orphaned forever).
    const channel = await fetchChannel(guild, row.channel_id);
    if (channel === undefined) continue;
    if (!channel) {
      deleteTempVoice(row.channel_id);
      removed++;
      continue;
    }
    // Vidé pendant l'arrêt (ou seulement des bots) : l'événement de départ a été manqué.
    if (!humansIn(channel).length) {
      if (await deleteTempChannel(channel, "Vocal V2 : salon temporaire vidé pendant l'arrêt du bot", record)) emptiedDeleted++;
      continue;
    }
    // Propriétaire parti pendant l'arrêt : la propriété passe au membre suivant.
    const humans = humansIn(channel);
    if (!humans.some((m) => m.id === row.owner_id)) {
      const nextOwnerId = pickNextOwner(humans.map((m) => ({ id: m.id, bot: false })), row.owner_id);
      if (nextOwnerId) await transferOwnership(channel, row.owner_id, nextOwnerId, "Vocal V2 : propriétaire parti pendant l'arrêt").catch(() => {});
    }
  }
  for (const [guildId, guildSettings] of Object.entries(settings ?? {})) {
    const config = guildSettings?.tempVoice;
    if (!config?.enabled || !config.hubChannelId) continue;
    const guild = client.guilds.cache.get(guildId);
    const hub = guild?.channels?.cache?.get(config.hubChannelId);
    for (const member of humansIn(hub)) {
      if (await createForMember(guild, member, config, record)) created++;
    }
  }
  if (removed) record("temp_voice_orphans_cleaned");
  if (emptiedDeleted) record("temp_voice_deleted");
  return { checked: rows.length, removed, emptiedDeleted, created };
}

/** Utilisé quand un salon temporaire est supprimé manuellement. */
export function forgetTempVoice(channelId) {
  forgetChannelState(channelId);
  deleteTempVoice(channelId);
}

export function forgetGuildTempVoices(guildId) {
  for (const row of allTempVoices().filter((r) => r.guild_id === guildId)) forgetChannelState(row.channel_id);
  deleteGuildTempVoices(guildId);
}

// ── Actions partagées par /voc et le panneau ────────────────────────────────

async function freshMember(guild, userId) {
  return guild.members.fetch({ user: userId, force: true }).catch(() => null);
}

/** Vérifie, à chaque action, que l'auteur gère encore ce salon. */
function requireManager(row, member) {
  if (!canManageTempVoice({ ownerId: row.owner_id, userId: member.id, hasManageChannels: member.permissions.has(P.ManageChannels) })) {
    throw new Error("Seul le propriétaire du salon (ou le staff) peut faire cela.");
  }
}

function requireOwner(row, member) {
  if (row.owner_id !== member.id) throw new Error("Seul le propriétaire du salon gère ses listes.");
}

async function resolveTarget(guild, userId, member) {
  const target = await freshMember(guild, userId);
  if (!target || target.user.bot) throw new Error("Choisis un membre (pas un bot).");
  if (target.id === member.id) throw new Error("Choisis quelqu'un d'autre que toi.");
  return target;
}

const ACTIONS = {
  async limit({ channel, row, member, value }) {
    requireManager(row, member);
    const limit = clampVoiceLimit(value);
    await channel.setUserLimit(limit, `Vocal V2 par ${member.user.tag}`);
    if (member.id === row.owner_id) savePrefs({ guildId: channel.guild.id, ownerId: row.owner_id, limit });
    return limit ? `👥 Limite réglée à ${limit} membre(s).` : "👥 Limite retirée.";
  },
  async name({ channel, row, member, value }) {
    requireManager(row, member);
    const name = String(value ?? "").trim();
    if (!tempVoiceNameIsValid(name)) throw new Error("Nom invalide (1 à 100 caractères, une seule ligne).");
    const check = renameAllowed(renameHistory.get(channel.id) ?? []);
    if (!check.allowed) throw new Error(`Discord limite à 2 renommages toutes les 10 minutes. Réessaie <t:${Math.ceil(check.retryAt / 1000)}:R>.`);
    renameHistory.set(channel.id, [...check.recent, Date.now()]);
    await channel.setName(name, `Vocal V2 par ${member.user.tag}`);
    if (member.id === row.owner_id) savePrefs({ guildId: channel.guild.id, ownerId: row.owner_id, name });
    return `✏️ Salon renommé en **${name}**. Ce nom sera repris pour ton prochain salon.`;
  },
  async lock({ channel, row, member, guildSettings }) {
    requireManager(row, member);
    await lockPrivateVoiceChannel(channel, member, channel.guild.members.me ?? channel.client, guildSettings?.sysPlus?.roleId ?? null);
    await applyListOverwrites(channel, row.owner_id);
    return "🔒 Salon verrouillé. Les demandes d'accès sont activées ; tes membres de confiance entrent toujours.";
  },
  async unlock({ channel, row, member }) {
    requireManager(row, member);
    await unlockPrivateVoiceChannel(channel);
    await applyListOverwrites(channel, row.owner_id);
    return "🔓 Salon déverrouillé. Les demandes en attente sont annulées ; les membres bloqués restent bloqués.";
  },
  async invite({ channel, row, member, targetId }) {
    requireManager(row, member);
    const target = await resolveTarget(channel.guild, targetId, member);
    await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member, reason: `Vocal V2 : invitation par ${member.user.tag}` });
    return `✅ <@${target.id}> peut rejoindre ce salon.`;
  },
  async kick({ channel, row, member, targetId }) {
    requireManager(row, member);
    const target = await resolveTarget(channel.guild, targetId, member);
    const refusal = await targetRefusal(channel.guild, member, target);
    if (refusal) throw new Error(refusal);
    if (target.id === row.owner_id && member.id !== row.owner_id) throw new Error("Transfère d'abord la propriété avant d'expulser le propriétaire.");
    await channel.permissionOverwrites.edit(target.id, { Connect: false }, { type: OverwriteType.Member, reason: `Vocal V2 : expulsion par ${member.user.tag}` });
    if (target.voice?.channelId === channel.id) await target.voice.disconnect(`Vocal V2 : expulsion par ${member.user.tag}`).catch(() => {});
    return `👢 <@${target.id}> a été sorti du salon et ne peut plus le rejoindre.`;
  },
  async transfer({ channel, row, member, targetId }) {
    requireManager(row, member);
    const target = await resolveTarget(channel.guild, targetId, member);
    if (target.voice?.channelId !== channel.id) throw new Error("Le nouveau propriétaire doit être dans le salon.");
    if (target.id === row.owner_id) throw new Error("Ce membre est déjà propriétaire.");
    await transferOwnership(channel, row.owner_id, target.id, `Vocal V2 : transfert par ${member.user.tag}`);
    return `👑 <@${target.id}> est maintenant propriétaire du salon.`;
  },
  async claim({ channel, row, member }) {
    if (member.voice?.channelId !== channel.id) throw new Error("Rejoins ce salon pour le revendiquer.");
    if (row.owner_id === member.id) throw new Error("Tu es déjà propriétaire.");
    const previous = await channel.guild.members.fetch(row.owner_id).catch(() => null);
    if (previous?.voice?.channelId === channel.id) throw new Error("Le propriétaire est encore dans le salon.");
    await transferOwnership(channel, row.owner_id, member.id, `Vocal V2 : revendiqué par ${member.user.tag}`);
    return "👑 Tu es maintenant propriétaire de ce salon.";
  },
  async delete({ channel, row, member, record }) {
    requireManager(row, member);
    await deleteTempChannel(channel, `Vocal V2 : suppression par ${member.user.tag}`, record);
    return "🗑️ Salon supprimé.";
  },
  async info({ channel, row }) {
    return { embeds: [infoEmbed(channel.guild, channel, row)] };
  },
};

/** Listes : liées au propriétaire, utilisables même hors de son salon. */
const LIST_ACTIONS = {
  async trust({ guild, member, targetId }) {
    const target = await resolveTarget(guild, targetId, member);
    const current = listEntry(guild.id, member.id, target.id);
    const refusal = listAddRefusal({ kind: "trusted", ownerId: member.id, targetId: target.id, currentSize: listSize(guild.id, member.id, "trusted"), alreadyListed: current?.kind === "trusted" });
    if (refusal) throw new Error(refusal);
    putListEntry({ guildId: guild.id, ownerId: member.id, targetId: target.id, kind: "trusted" });
    const owned = await ownedChannel(guild, member.id);
    if (owned) await owned.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member, reason: "Vocal V2 : membre de confiance" }).catch(() => {});
    return `⭐ <@${target.id}> est dans ta liste de confiance : il ou elle pourra toujours entrer dans tes salons, même verrouillés.`;
  },
  async block({ guild, member, targetId }) {
    const target = await resolveTarget(guild, targetId, member);
    const refusal = await targetRefusal(guild, member, target)
      ?? listAddRefusal({ kind: "blocked", ownerId: member.id, targetId: target.id, currentSize: listSize(guild.id, member.id, "blocked"), alreadyListed: listEntry(guild.id, member.id, target.id)?.kind === "blocked" });
    if (refusal) throw new Error(refusal);
    putListEntry({ guildId: guild.id, ownerId: member.id, targetId: target.id, kind: "blocked" });
    const owned = await ownedChannel(guild, member.id);
    if (owned) {
      await owned.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: null }, { type: OverwriteType.Member, reason: "Vocal V2 : membre bloqué" }).catch(() => {});
      if (target.voice?.channelId === owned.id) await target.voice.disconnect("Vocal V2 : membre bloqué").catch(() => {});
    }
    return `⛔ <@${target.id}> est bloqué : il ou elle ne pourra plus entrer dans tes salons.`;
  },
  async unlist({ guild, member, targetId }) {
    const removed = removeListEntry(guild.id, member.id, targetId);
    if (!removed) throw new Error("Ce membre n'est dans aucune de tes listes.");
    const owned = await ownedChannel(guild, member.id);
    if (owned) await owned.permissionOverwrites.edit(targetId, { Connect: null, ViewChannel: null }, { type: OverwriteType.Member, reason: "Vocal V2 : retiré des listes" }).catch(() => {});
    return `↩️ <@${targetId}> a été retiré de tes listes.`;
  },
  async lists({ guild, member }) {
    const entries = listEntries(guild.id, member.id);
    const show = (kind) => entries.filter((e) => e.kind === kind).map((e) => `<@${e.targetId}>`).join(", ") || "personne";
    return {
      embeds: [themePanelEmbed(new EmbedBuilder()
        .setTitle("📋 Tes listes de salon vocal")
        .addFields(
          { name: `⭐ Confiance (${entries.filter((e) => e.kind === "trusted").length}/${MAX_LIST_ENTRIES})`, value: show("trusted").slice(0, 1024) },
          { name: `⛔ Bloqués (${entries.filter((e) => e.kind === "blocked").length}/${MAX_LIST_ENTRIES})`, value: show("blocked").slice(0, 1024) },
        )
        .setDescription("Ces listes s'appliquent à chaque salon que tu crées sur ce serveur."), { animated: false })],
    };
  },
};

async function ownedChannel(guild, ownerId) {
  const row = latestTempVoiceOf(guild.id, ownerId);
  if (!row) return null;
  return (await fetchChannel(guild, row.channel_id)) ?? null;
}

const SLASH_TO_ACTION = {
  limit: "limit", name: "name", lock: "lock", unlock: "unlock", inviter: "invite", expulser: "kick",
  transferer: "transfer", claim: "claim", delete: "delete",
};
const SLASH_TO_LIST = { confiance: "trust", bloquer: "block", retirer: "unlist", listes: "lists" };

function asPayload(result) {
  return typeof result === "string" ? { content: result } : result;
}

async function replyError(interaction, error) {
  const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
  else await interaction.reply({ content, ephemeral: true }).catch(() => {});
}

// ── Composants du panneau (boutons, sélecteurs, formulaires) ────────────────

const SELECT_LABELS = {
  invite: "Choisis le membre à inviter", kick: "Choisis le membre à expulser", transfer: "Choisis le nouveau propriétaire",
  trust: "Choisis un membre de confiance", block: "Choisis le membre à bloquer", unlist: "Choisis le membre à retirer de tes listes",
};

async function handlePanelComponent(interaction, guildSettings, record) {
  const parsed = parsePanelId(interaction.customId);
  if (!parsed) return false;
  const guild = interaction.guild;
  if (!guild) return false;
  const { action, channelId } = parsed;
  try {
    const member = await freshMember(guild, interaction.user.id);
    if (!member) throw new Error("Impossible d'actualiser ton profil serveur. Réessaie.");
    const row = getTempVoice(channelId);
    if (!row || row.guild_id !== guild.id) throw new Error("Ce salon temporaire n'existe plus.");
    const channel = await fetchChannel(guild, channelId);
    if (!channel) throw new Error("Salon temporaire introuvable.");
    const isList = ["trust", "block", "unlist"].includes(action);

    // 1. Bouton qui demande un membre : sélecteur éphémère.
    if (interaction.isButton() && SELECT_LABELS[action]) {
      if (isList) requireOwner(row, member); else if (action !== "claim") requireManager(row, member);
      await interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(buildPanelId(action, channelId)).setPlaceholder(SELECT_LABELS[action]).setMinValues(1).setMaxValues(1))],
      });
      return true;
    }
    // 2. Bouton qui demande une valeur : formulaire.
    if (interaction.isButton() && (action === "limit" || action === "name")) {
      requireManager(row, member);
      const input = action === "limit"
        ? new TextInputBuilder().setCustomId("value").setLabel("Limite (0 = illimitée, 1 à 99)").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setValue(String(channel.userLimit ?? 0))
        : new TextInputBuilder().setCustomId("value").setLabel("Nouveau nom du salon").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(100).setValue(channel.name.slice(0, 100));
      await interaction.showModal(new ModalBuilder().setCustomId(buildPanelId(action, channelId)).setTitle(action === "limit" ? "Limite du salon" : "Renommer le salon").addComponents(new ActionRowBuilder().addComponents(input)));
      return true;
    }
    if (interaction.isModalSubmit()) {
      const raw = interaction.fields.getTextInputValue("value").trim();
      if (action === "limit" && !/^\d{1,2}$/.test(raw)) throw new Error("Entre un nombre entre 0 et 99.");
      await interaction.deferReply({ ephemeral: true });
      const result = await ACTIONS[action]({ channel, row, member, value: action === "limit" ? Number(raw) : raw, guildSettings, record });
      await interaction.editReply({ ...asPayload(result), allowedMentions: { parse: [] } });
      return true;
    }
    const targetId = interaction.isUserSelectMenu?.() ? interaction.values[0] : null;
    if (SELECT_LABELS[action] && !targetId) throw new Error("Choisis un membre.");
    await interaction.deferReply({ ephemeral: true });
    let result;
    if (isList) {
      requireOwner(row, member);
      result = await LIST_ACTIONS[action]({ guild, member, targetId });
    } else {
      result = await ACTIONS[action]({ channel, row, member, targetId, guildSettings, record });
    }
    await interaction.editReply({ ...asPayload(result), allowedMentions: { parse: [] } });
  } catch (error) {
    await replyError(interaction, error);
  }
  return true;
}

export async function handleVoiceV2Interaction(interaction, guildSettings = {}, record = () => {}) {
  if (typeof interaction.customId === "string" && interaction.customId.startsWith("tvc:")) {
    return handlePanelComponent(interaction, guildSettings, record);
  }
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "voc") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const member = await freshMember(guild, interaction.user.id);
  if (!member) {
    await interaction.reply({ content: "Impossible d’actualiser ton profil serveur. Réessaie.", ephemeral: true });
    return true;
  }
  const channelId = member.voice?.channelId;
  const row = channelId ? getTempVoice(channelId) : null;
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "demander" || subcommand === "demander-id") {
      const target = subcommand === "demander"
        ? interaction.options.getChannel("salon", true)
        : null;
      const targetId = target?.id ?? interaction.options.getString("id", true).trim();
      if (target && (target.guildId !== guild.id || target.type !== ChannelType.GuildVoice)) {
        throw new Error("Choisis une vocale de ce serveur.");
      }
      if (!/^\d{5,25}$/.test(targetId)) throw new Error("L’ID de la vocale est invalide.");
      await interaction.deferReply({ ephemeral: true });
      const adaptedMessage = {
        guild,
        member,
        author: interaction.user,
        client: interaction.client,
        channel: interaction.channel,
        content: `=demandevocal ${target ? `<#${target.id}>` : targetId}`,
        mentions: { channels: { first: () => null } },
        reply: (payload) => interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
      };
      await handleVoiceAccessRequestMessage(adaptedMessage, guildSettings);
      return true;
    }
    if (subcommand === "debloquer") {
      const targetChannel = interaction.options.getChannel("salon", true);
      const targetMember = interaction.options.getMember("membre") ?? await guild.members.fetch(interaction.options.getUser("membre", true).id).catch(() => null);
      if (targetChannel.guildId !== guild.id || targetChannel.type !== ChannelType.GuildVoice || !targetMember) throw new Error("Choisis une vocale et un membre de ce serveur.");
      const result = removeVoiceAccessBlock({
        guildId: guild.id, channelId: targetChannel.id, userId: targetMember.id, actorId: member.id,
        authorizeActor: ({ actorId }) => actorId === guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageChannels) || member.permissions.has(PermissionFlagsBits.Administrator),
      });
      await interaction.reply({ content: result.removed ? `✅ <@${targetMember.id}> peut à nouveau demander l'accès à **${targetChannel.name}**.` : "Ce membre n'était pas bloqué sur cette vocale.", ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    if (subcommand === "vocal-panel") {
      await interaction.deferReply({ ephemeral: true });
      const adaptedMessage = {
        id: interaction.id,
        guild,
        member,
        author: interaction.user,
        client: interaction.client,
        channel: interaction.channel,
        content: "=panel",
        mentions: { users: { first: () => null }, members: { first: () => null } },
        reply: (payload) => interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
      };
      await handleVoiceMessage(adaptedMessage, guildSettings);
      return true;
    }
    if (SLASH_TO_LIST[subcommand]) {
      await interaction.deferReply({ ephemeral: true });
      const targetId = subcommand === "listes" ? null : interaction.options.getUser("membre", true).id;
      const result = await LIST_ACTIONS[SLASH_TO_LIST[subcommand]]({ guild, member, targetId });
      await interaction.editReply({ ...asPayload(result), allowedMentions: { parse: [] } });
      return true;
    }
    if (!row) throw new Error("Tu dois être dans un salon temporaire.");
    const channel = await fetchChannel(guild, row.channel_id);
    if (!channel) throw new Error("Salon temporaire introuvable.");
    if (subcommand === "panel") {
      const manager = canManageTempVoice({ ownerId: row.owner_id, userId: member.id, hasManageChannels: member.permissions.has(P.ManageChannels) });
      await interaction.reply({
        embeds: [infoEmbed(guild, channel, row)],
        components: manager || member.voice?.channelId === channel.id ? controlPanelComponents(channel.id) : [],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }
    const action = SLASH_TO_ACTION[subcommand];
    if (!action) throw new Error("Sous-commande inconnue.");
    await interaction.deferReply({ ephemeral: true });
    const value = subcommand === "limit" ? interaction.options.getInteger("nombre", true)
      : subcommand === "name" ? interaction.options.getString("nom", true) : undefined;
    const targetId = ["inviter", "expulser", "transferer"].includes(subcommand) ? interaction.options.getUser("membre", true).id : null;
    const result = await ACTIONS[action]({ channel, row, member, value, targetId, guildSettings, record });
    await interaction.editReply({ ...asPayload(result), allowedMentions: { parse: [] } });
  } catch (error) {
    await replyError(interaction, error);
  }
  return true;
}
