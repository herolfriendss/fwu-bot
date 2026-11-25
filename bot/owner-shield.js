// FWU — OWNER shield: nobody can touch the OWNER through any bot, by any path.
//
// Installed once at startup, it wraps the discord.js calls that change a member or a
// channel permission. Whatever the source (slash command, button, panel, background job,
// automatic protection, temporary voice), a harmful change aimed at the OWNER
// (PND_OWNER_DISCORD_ID) is refused BEFORE anything is sent to Discord:
//   kick, ban, timeout, nickname change, role removal, server mute/deafen, voice
//   disconnect, and any channel permission that denies the OWNER something.
// Harmless changes stay possible (adding a role, moving into a voice channel, lifting a
// timeout or a mute), and the OWNER's own commands are never blocked.
//
// Same layer, for everyone: during an action started by a member (an interaction), a
// harmful change to ANOTHER member is refused unless the actor's highest role is
// strictly above the target's. Full access: the OWNER and the server owner. Automatic
// protections (no member behind them) are configured by the staff and are not ranked.
import { AsyncLocalStorage } from "node:async_hooks";
import { GuildBanManager, GuildChannelManager, GuildMemberManager, GuildMemberRoleManager, PermissionOverwriteManager, PermissionsBitField } from "discord.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

export const OWNER_SHIELD_MESSAGE = "⛔ L'OWNER est protégé : aucune action ne peut le viser.";
export const RANK_SHIELD_MESSAGE = "⛔ Tu ne peux agir que sur un membre dont le rôle le plus élevé est en dessous du tien.";
export const HIERARCHY_UNREADABLE_MESSAGE = "⛔ Impossible de vérifier la hiérarchie des rôles. Action refusée par sécurité.";
const context = new AsyncLocalStorage();
let installed = false;
let onBlocked = () => {};

export class OwnerShieldError extends Error {
  constructor(action, message = OWNER_SHIELD_MESSAGE) {
    super(message);
    this.name = "OwnerShieldError";
    this.code = "OWNER_PROTECTED";
    this.action = action;
  }
}

export function ownerId() {
  return parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
}

/** Run `fn` on behalf of `actorId` (an interaction's user). The OWNER's own actions pass. */
export function runAsActor(actorId, fn) {
  return context.run({ actorId: actorId ?? null }, fn);
}

function shielded(targetId) {
  const owner = ownerId();
  return Boolean(owner) && targetId === owner && context.getStore()?.actorId !== owner;
}

function block(action, message) {
  try { onBlocked(action); } catch { /* reporting must never unblock */ }
  throw new OwnerShieldError(action, message);
}

/** Pure rank rule between two members (positions = highest role positions). */
export function rankAllows({ actorId, targetId, actorPosition, targetPosition, guildOwnerId = null, owner = ownerId(), allowMissingTarget = false }) {
  if (!actorId || !targetId || actorId === targetId) return true;
  if (actorId === owner || actorId === guildOwnerId) return true;
  // Le propriétaire du serveur est protégé au même titre qu'une cible hiérarchiquement supérieure.
  if (targetId === guildOwnerId) return false;
  if (targetPosition === null || targetPosition === undefined) return allowMissingTarget;
  if (!Number.isFinite(actorPosition) || !Number.isFinite(targetPosition)) return false;
  return actorPosition > targetPosition;
}

function isUnknownGuildMember(error) {
  return Number(error?.code ?? error?.rawError?.code) === 10007;
}

/**
 * Fetch a fresh role position. A confirmed 404/Unknown Member is represented by null;
 * network/API errors and malformed role data remain unverifiable (NaN / thrown error).
 */
async function position(guild, id) {
  if (!guild?.members?.fetch) return Number.NaN;
  let member;
  try {
    member = await guild.members.fetch({ user: id, force: true });
  } catch (error) {
    if (isUnknownGuildMember(error)) return null;
    throw error;
  }
  if (!member) return null;
  const value = member.roles?.highest?.position;
  return Number.isFinite(value) ? value : Number.NaN;
}

/** Refuse a harmful change to `targetId` when the member behind the current action is not ranked above. */
async function enforceRank(guild, targetId, action, { allowMissingTarget = false } = {}) {
  const actorId = context.getStore()?.actorId;
  if (!actorId || !guild || actorId === targetId) return;
  if (targetId === guild.ownerId && actorId !== guild.ownerId && actorId !== ownerId()) {
    block(action, RANK_SHIELD_MESSAGE);
  }
  if (actorId === ownerId() || actorId === guild.ownerId) return;

  let actorPosition;
  let targetPosition;
  try {
    [actorPosition, targetPosition] = await Promise.all([
      position(guild, actorId),
      position(guild, targetId),
    ]);
  } catch {
    block(action, HIERARCHY_UNREADABLE_MESSAGE);
  }

  // Missing targets are acceptable only for ban-by-ID. A failed lookup is never
  // confused with a member who is confirmed not to be in the guild.
  if (targetPosition === null && allowMissingTarget) return;
  if (!rankAllows({
    actorId,
    targetId,
    actorPosition,
    targetPosition,
    guildOwnerId: guild.ownerId,
    allowMissingTarget,
  })) {
    block(action, targetPosition === null || !Number.isFinite(actorPosition)
      ? HIERARCHY_UNREADABLE_MESSAGE
      : RANK_SHIELD_MESSAGE);
  }
}

const deniesSomething = (deny) => {
  try { return PermissionsBitField.resolve(deny ?? 0n) !== 0n; } catch { return true; }
};

/** Pure: which harmful parts of a member edit would hit the OWNER. */
export function harmfulMemberEdit(options = {}, currentRoleIds = null) {
  const harms = [];
  if ("nick" in options) harms.push("surnom");
  if (options.communicationDisabledUntil != null) harms.push("exclusion temporaire");
  if (options.mute === true) harms.push("mute vocal");
  if (options.deaf === true) harms.push("sourdine");
  if ("channel" in options && options.channel === null) harms.push("déconnexion vocale");
  if (options.roles) {
    const next = new Set(Array.from(options.roles.values?.() ?? options.roles, (role) => (typeof role === "string" ? role : role?.id)));
    if (!currentRoleIds || [...currentRoleIds].some((id) => !next.has(id))) harms.push("retrait de rôle");
  }
  return harms;
}

/** Pure: true when a list of overwrites denies anything to the OWNER. */
export function overwritesHarmOwner(overwrites, owner = ownerId(), ownerRoleIds = []) {
  if (!overwrites || !owner) return false;
  const protectedIds = new Set([owner, ...ownerRoleIds].filter(Boolean));
  const list = Array.from(overwrites.values?.() ?? overwrites);
  return list.some((o) => protectedIds.has(o?.id ?? o?.user?.id) && deniesSomething(o?.deny));
}

async function ownerRoleIdsForGuild(guild) {
  const owner = ownerId();
  if (!owner || !guild?.id) return [];
  let member = guild.members?.cache?.get?.(owner);
  if (!member && guild.members?.fetch) {
    member = await guild.members.fetch({ user: owner, force: true }).catch((error) => {
      if (isUnknownGuildMember(error)) return null;
      throw error;
    });
  }
  // @everyone is inherited by every member, including the configured OWNER.
  return [guild.id, ...(member?.roles?.cache?.keys?.() ?? [])];
}

export function installOwnerShield({ report = () => {} } = {}) {
  onBlocked = report;
  if (installed) return;
  installed = true;
  const resolveUserId = (manager, user) => manager.client?.users?.resolveId?.(user) ?? (typeof user === "string" ? user : user?.id);

  const edit = GuildMemberManager.prototype.edit;
  GuildMemberManager.prototype.edit = async function (user, options = {}) {
    const id = resolveUserId(this, user);
    if (shielded(id)) {
      let current = null;
      if (options.roles) {
        const member = this.cache.get(id) ?? (await this.fetch({ user: id, force: true }).catch(() => null));
        current = member ? new Set(member.roles.cache.keys()) : null;
      }
      const harms = harmfulMemberEdit(options, current);
      if (harms.length) block(harms.join(", "));
    } else if (context.getStore()?.actorId) {
      let current = null;
      if (options.roles) {
        const member = this.cache.get(id) ?? (await this.fetch({ user: id }).catch(() => null));
        current = member ? new Set(member.roles.cache.keys()) : null;
      }
      const harms = harmfulMemberEdit(options, current);
      if (harms.length) await enforceRank(this.guild, id, harms.join(", "));
    }
    return edit.call(this, user, options);
  };

  const kick = GuildMemberManager.prototype.kick;
  GuildMemberManager.prototype.kick = async function (user, reason) {
    const id = resolveUserId(this, user);
    if (shielded(id)) block("expulsion");
    await enforceRank(this.guild, id, "expulsion");
    return kick.call(this, user, reason);
  };

  const ban = GuildBanManager.prototype.create;
  GuildBanManager.prototype.create = async function (user, options) {
    const id = resolveUserId(this, user);
    if (shielded(id)) block("bannissement");
    await enforceRank(this.guild, id, "bannissement");
    return ban.call(this, user, options);
  };

  const removeRole = GuildMemberRoleManager.prototype.remove;
  GuildMemberRoleManager.prototype.remove = async function (roles, reason) {
    if (shielded(this.member?.id)) block("retrait de rôle");
    await enforceRank(this.guild ?? this.member?.guild, this.member?.id, "retrait de rôle");
    return removeRole.call(this, roles, reason);
  };

  const upsert = PermissionOverwriteManager.prototype.upsert;
  PermissionOverwriteManager.prototype.upsert = async function (userOrRole, options = {}, overwriteOptions, existing) {
    const id = resolveUserId(this, userOrRole);
    const configuredOwner = shielded(ownerId()) ? ownerId() : null;
    const deniedPermissions = Object.entries(options)
      .filter(([, value]) => value === false)
      .map(([permission]) => permission);
    if (configuredOwner && deniedPermissions.length) {
      const guild = this.channel?.guild;
      let protectedRoleIds;
      try {
        protectedRoleIds = await ownerRoleIdsForGuild(guild);
      } catch {
        block("impossible de vérifier les rôles de l'OWNER avant une modification de permissions", HIERARCHY_UNREADABLE_MESSAGE);
      }
      if (overwritesHarmOwner([{ id, deny: deniedPermissions }], configuredOwner, protectedRoleIds)) {
        block("permission refusée sur un rôle ou un salon de l'OWNER");
      }
    }
    return upsert.call(this, userOrRole, options, overwriteOptions, existing);
  };

  const owner = () => (shielded(ownerId()) ? ownerId() : null);
  const createChannel = GuildChannelManager.prototype.create;
  GuildChannelManager.prototype.create = async function (options = {}) {
    const protectedOwner = owner();
    if (protectedOwner && options.permissionOverwrites) {
      let protectedRoleIds;
      try { protectedRoleIds = await ownerRoleIdsForGuild(this.guild); }
      catch { block("impossible de vérifier les rôles de l'OWNER avant la création du salon", HIERARCHY_UNREADABLE_MESSAGE); }
      if (overwritesHarmOwner(options.permissionOverwrites, protectedOwner, protectedRoleIds)) {
        block("salon qui exclut l'OWNER par un refus direct ou hérité");
      }
    }
    return createChannel.call(this, options);
  };
  const editChannel = GuildChannelManager.prototype.edit;
  GuildChannelManager.prototype.edit = async function (channel, options = {}) {
    const protectedOwner = owner();
    if (protectedOwner && options.permissionOverwrites) {
      const target = typeof channel === "string" ? this.cache?.get?.(channel) : channel;
      const guild = target?.guild ?? this.guild;
      let protectedRoleIds;
      try { protectedRoleIds = await ownerRoleIdsForGuild(guild); }
      catch { block("impossible de vérifier les rôles de l'OWNER avant la modification du salon", HIERARCHY_UNREADABLE_MESSAGE); }
      if (overwritesHarmOwner(options.permissionOverwrites, protectedOwner, protectedRoleIds)) {
        block("permission refusée sur un salon de l'OWNER par un refus direct ou hérité");
      }
    }
    return editChannel.call(this, channel, options);
  };
}
