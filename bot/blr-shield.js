// FWU V2 — bouclier BLR au niveau discord.js : aucun chemin du bot (commande, rankall,
// boutique, niveaux, réaction, CAPTCHA, rôle automatique, automatisation, anniversaire,
// couleur, restauration…) ne peut donner à un membre BLR un rôle au-dessus du rôle membre.
// Les rôles autorisés passent ; s'il y en a un seul interdit, l'appel est refusé avant
// tout envoi à Discord. Les opérations du module BLR (runBlrInternal) passent.
import { GuildMemberManager, GuildMemberRoleManager } from "discord.js";
import { BLR_REFUSAL, getBlrConfig, isBlr, isBlrInternal, roleAllowedForBlr } from "./blr.js";

export class BlrShieldError extends Error {
  constructor(message = BLR_REFUSAL) {
    super(message);
    this.name = "BlrShieldError";
    this.code = "BLR_PROTECTED";
  }
}

function toList(roles) {
  if (!roles) return [];
  if (typeof roles === "string" || roles.id) return [roles];
  return Array.from(roles.values?.() ?? roles);
}

function resolveRole(guild, role) {
  if (typeof role !== "string") return role;
  return guild?.roles?.cache?.get?.(role) ?? role;
}

/** Lève BlrShieldError si l'un des rôles ajoutés est interdit pour ce membre BLR. */
export function assertBlrAllows(guild, userId, roles, { currentRoleIds = [] } = {}) {
  if (isBlrInternal() || !guild?.id || !userId || !isBlr(guild.id, userId)) return;
  const config = { guildId: guild.id, ...getBlrConfig(guild.id) };
  const current = new Set(currentRoleIds);
  for (const role of toList(roles)) {
    const resolved = resolveRole(guild, role);
    const id = typeof resolved === "string" ? resolved : resolved?.id;
    if (current.has(id)) continue; // déjà porté : pas un ajout
    if (!roleAllowedForBlr(resolved, config)) throw new BlrShieldError();
  }
}

let installed = false;
let onBlocked = () => {};

export function installBlrShield({ report = () => {} } = {}) {
  onBlocked = report;
  if (installed) return;
  installed = true;
  const guard = (guild, userId, roles, currentRoleIds) => {
    try {
      assertBlrAllows(guild, userId, roles, { currentRoleIds });
    } catch (error) {
      try { onBlocked({ guildId: guild?.id, userId }); } catch { /* le signalement ne débloque rien */ }
      throw error;
    }
  };

  const add = GuildMemberRoleManager.prototype.add;
  GuildMemberRoleManager.prototype.add = async function (roles, reason) {
    guard(this.guild, this.member?.id, roles, [...(this.cache?.keys?.() ?? [])]);
    return add.call(this, roles, reason);
  };

  const addRole = GuildMemberManager.prototype.addRole;
  if (typeof addRole === "function") {
    GuildMemberManager.prototype.addRole = async function (options = {}) {
      const userId = typeof options.user === "string" ? options.user : options.user?.id;
      const current = this.cache?.get?.(userId)?.roles?.cache;
      guard(this.guild, userId, options.role, [...(current?.keys?.() ?? [])]);
      return addRole.call(this, options);
    };
  }

  const edit = GuildMemberManager.prototype.edit;
  GuildMemberManager.prototype.edit = async function (user, options = {}) {
    if (options?.roles) {
      const userId = typeof user === "string" ? user : user?.id;
      const current = this.cache?.get?.(userId)?.roles?.cache;
      guard(this.guild, userId, options.roles, [...(current?.keys?.() ?? [])]);
    }
    return edit.call(this, user, options);
  };
}
