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
import { AsyncLocalStorage } from "node:async_hooks";
import { GuildBanManager, GuildChannelManager, GuildMemberManager, GuildMemberRoleManager, PermissionOverwriteManager, PermissionsBitField } from "discord.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

export const OWNER_SHIELD_MESSAGE = "⛔ L'OWNER est protégé : aucune action ne peut le viser.";
const context = new AsyncLocalStorage();
let installed = false;
let onBlocked = () => {};

export class OwnerShieldError extends Error {
  constructor(action) {
    super(OWNER_SHIELD_MESSAGE);
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

function block(action) {
  try { onBlocked(action); } catch { /* reporting must never unblock */ }
  throw new OwnerShieldError(action);
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
export function overwritesHarmOwner(overwrites, owner = ownerId()) {
  if (!overwrites || !owner) return false;
  const list = Array.from(overwrites.values?.() ?? overwrites);
  return list.some((o) => (o?.id ?? o?.user?.id) === owner && deniesSomething(o?.deny));
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
    }
    return edit.call(this, user, options);
  };

  const kick = GuildMemberManager.prototype.kick;
  GuildMemberManager.prototype.kick = async function (user, reason) {
    if (shielded(resolveUserId(this, user))) block("expulsion");
    return kick.call(this, user, reason);
  };

  const ban = GuildBanManager.prototype.create;
  GuildBanManager.prototype.create = async function (user, options) {
    if (shielded(resolveUserId(this, user))) block("bannissement");
    return ban.call(this, user, options);
  };

  const removeRole = GuildMemberRoleManager.prototype.remove;
  GuildMemberRoleManager.prototype.remove = async function (roles, reason) {
    if (shielded(this.member?.id)) block("retrait de rôle");
    return removeRole.call(this, roles, reason);
  };

  const upsert = PermissionOverwriteManager.prototype.upsert;
  PermissionOverwriteManager.prototype.upsert = async function (userOrRole, options = {}, overwriteOptions, existing) {
    const id = resolveUserId(this, userOrRole);
    if (shielded(id) && Object.values(options).some((value) => value === false)) block("permission refusée sur un salon");
    return upsert.call(this, userOrRole, options, overwriteOptions, existing);
  };

  const owner = () => (shielded(ownerId()) ? ownerId() : null);
  const createChannel = GuildChannelManager.prototype.create;
  GuildChannelManager.prototype.create = async function (options = {}) {
    if (overwritesHarmOwner(options.permissionOverwrites, owner())) block("salon qui exclut l'OWNER");
    return createChannel.call(this, options);
  };
  const editChannel = GuildChannelManager.prototype.edit;
  GuildChannelManager.prototype.edit = async function (channel, options = {}) {
    if (overwritesHarmOwner(options.permissionOverwrites, owner())) block("permission refusée sur un salon");
    return editChannel.call(this, channel, options);
  };
}
