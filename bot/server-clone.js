import { createHash } from "node:crypto";
import { stripPrivilegedPermissions } from "./role-grant-guard.js";
import { authorize } from "./platform/policy/authorize.js";

/**
 * SYS+ Server Clone (Server Tools pack).
 *
 * Restores a Time Machine blueprint onto a server ADDITIVELY:
 *  - nothing is deleted, renamed or modified; items that already exist by name
 *    are reported and left untouched;
 *  - the plan is hashed, and applying requires the same token, so a plan that
 *    went stale (the server changed since the preview) is refused;
 *  - privileged permission bits are stripped from restored roles, so a blueprint
 *    from any server can never recreate Administrator or other dangerous powers;
 *  - Discord hard limits are enforced before any creation starts.
 *
 * Pure planning is kept free of Discord I/O. Application receives an injected
 * executor so it can be tested without a Discord connection.
 */

export const SERVER_CLONE_ENTITLEMENT = "server.tools";
export const SERVER_CLONE_ACTION = "server.clone.apply";
export const DISCORD_MAX_ROLES = 250;
export const DISCORD_MAX_CHANNELS = 500;
const MAX_CONSECUTIVE_FAILURES = 5;
const CHANNEL_CATEGORY = 4;

// Permission bits that must never be restored by a clone, whatever the source.
// Values match Discord's permission bitfield (ADMINISTRATOR, KICK_MEMBERS,
// BAN_MEMBERS, MANAGE_GUILD, MANAGE_ROLES, MANAGE_WEBHOOKS, MANAGE_GUILD_EXPRESSIONS).
/** Removes privileged bits from a restored role's permission string (liste commune aux 5 bots). */
export function sanitizeRolePermissions(permissions) {
  return stripPrivilegedPermissions(permissions);
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Builds the additive restore plan. `snapshot` is a validated blueprint snapshot
 * (schemaVersion 1); `guild` is the live target guild with roles/channels caches.
 * Existing items (same role name, or same channel type and name) are referenced
 * by their target id and never modified, so overwrites and category links still
 * resolve correctly.
 */
export function buildServerClonePlan({ snapshot, guild }) {
  if (!snapshot || snapshot.schemaVersion !== 1) throw new Error("Blueprint invalide ou version non prise en charge.");
  if (!guild?.id) throw new Error("Serveur cible invalide.");

  const existingRoles = [...(guild.roles?.cache?.values?.() ?? [])].filter((role) => !role.managed && role.id !== guild.id);
  const existingChannels = [...(guild.channels?.cache?.values?.() ?? [])].filter((channel) => !channel.isThread?.());
  // Un nom porté par plusieurs rôles est ambigu (un rôle perso peut imiter un rôle de staff) :
  // on ne s'y rattache jamais, le rôle du blueprint sera recréé sans permission sensible.
  const nameCounts = new Map();
  for (const role of existingRoles) nameCounts.set(role.name, (nameCounts.get(role.name) ?? 0) + 1);
  const existingRoleIdByName = new Map(existingRoles.filter((role) => nameCounts.get(role.name) === 1).map((role) => [role.name, role.id]));
  const existingChannelIdByKey = new Map(existingChannels.map((channel) => [`${channel.type}:${channel.name}`, channel.id]));
  const warnings = [];
  const stripped = [];

  const roles = [];
  const existingRoleMap = [];
  const roleTarget = new Map(); // snapshot role id -> target role id (existing) or null (to create)
  for (const role of [...(snapshot.roles ?? [])].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))) {
    // The default @everyone role shares the guild's id and always exists on the target.
    // Its overwrites are remapped through sourceGuildId / targetGuildId, never recreated.
    if (role.id === snapshot.guildId || role.name === "@everyone") continue;
    if (existingRoleIdByName.has(role.name)) {
      const targetId = existingRoleIdByName.get(role.name);
      roleTarget.set(role.id, targetId);
      existingRoleMap.push([role.id, targetId]);
      continue;
    }
    roleTarget.set(role.id, null);
    const clean = sanitizeRolePermissions(role.permissions);
    if (clean.stripped.length) stripped.push({ role: String(role.name).slice(0, 100), bits: clean.stripped });
    roles.push({
      snapshotId: role.id,
      name: String(role.name ?? "Rôle").slice(0, 100),
      color: Number(role.color) || 0,
      hoist: Boolean(role.hoist),
      mentionable: Boolean(role.mentionable),
      permissions: clean.permissions,
      position: Number(role.position) || 0,
    });
  }

  const channels = [];
  const channelTarget = new Map(); // snapshot channel id -> { kind: "existing"|"create", id }
  const ordered = [...(snapshot.channels ?? [])].sort((a, b) =>
    (Number(a.type) === CHANNEL_CATEGORY ? 0 : 1) - (Number(b.type) === CHANNEL_CATEGORY ? 0 : 1)
    || (Number(a.position) || 0) - (Number(b.position) || 0)
    || String(a.id).localeCompare(String(b.id)));
  for (const channel of ordered) {
    const key = `${Number(channel.type)}:${channel.name}`;
    if (existingChannelIdByKey.has(key)) {
      channelTarget.set(channel.id, { kind: "existing", id: existingChannelIdByKey.get(key) });
      continue;
    }
    let parentRef = null;
    if (channel.parentId) {
      const parent = channelTarget.get(channel.parentId);
      if (parent) parentRef = parent;
      else warnings.push(`« ${String(channel.name).slice(0, 60)} » reste hors catégorie : sa catégorie n'a pas pu être rattachée.`);
    }
    channelTarget.set(channel.id, { kind: "create", id: channel.id });
    channels.push({
      snapshotId: channel.id,
      name: String(channel.name ?? "salon").slice(0, 100),
      type: Number(channel.type),
      parentRef,
      topic: channel.topic ? String(channel.topic).slice(0, 1024) : null,
      nsfw: Boolean(channel.nsfw),
      rateLimitPerUser: Number(channel.rateLimitPerUser) || 0,
      bitrate: Number(channel.bitrate) || 0,
      userLimit: Number(channel.userLimit) || 0,
      permissionOverwrites: (channel.permissionOverwrites ?? [])
        .filter((overwrite) => Number(overwrite.type) === 0)
        // Les autorisations de salon sont nettoyées comme celles des rôles : un salon recréé ne
        // donne jamais Gérer les permissions, Déplacer, Mentionner @everyone… à un rôle.
        .map((overwrite) => {
          const clean = sanitizeRolePermissions(overwrite.allow ?? "0");
          if (clean.stripped.length) stripped.push({ role: `#${String(channel.name).slice(0, 60)}`, bits: clean.stripped });
          return { id: overwrite.id, allow: clean.permissions, deny: String(overwrite.deny ?? "0") };
        }),
    });
  }

  const capacity = {
    roles: { current: existingRoles.length, creates: roles.length, max: DISCORD_MAX_ROLES },
    channels: { current: existingChannels.length, creates: channels.length, max: DISCORD_MAX_CHANNELS },
  };
  if (capacity.roles.current + capacity.roles.creates > DISCORD_MAX_ROLES) throw new Error("Le serveur ne peut pas accueillir assez de rôles pour ce blueprint.");
  if (capacity.channels.current + capacity.channels.creates > DISCORD_MAX_CHANNELS) throw new Error("Le serveur ne peut pas accueillir assez de salons pour ce blueprint.");

  const body = {
    schemaVersion: 1,
    sourceGuildId: snapshot.guildId ?? null,
    targetGuildId: guild.id,
    roles,
    existingRoleMap,
    channels,
    skippedExistingRoles: existingRoleMap.map(([snapshotId]) => snapshotId),
    skippedExistingChannels: [...channelTarget.entries()].filter(([, v]) => v.kind === "existing").map(([id]) => id),
    stripped,
    warnings,
    capacity,
  };
  return { ...body, token: hash(body).slice(0, 16) };
}

/**
 * Authorizes a clone application. Returns true only when the decision is a
 * confirmed, fully authorized one (authorize() also returns allow:true while a
 * confirmation is still pending, so the code must be checked).
 */
export function authorizeServerClone({ guildId, actorId, tiers, entitlements, moduleEnabled = true, confirmed = false }) {
  const decision = authorize({
    guildId,
    actor: { id: actorId },
    actionPolicy: {
      key: SERVER_CLONE_ACTION,
      minTiers: ["SYS_PLUS"],
      entitlement: SERVER_CLONE_ENTITLEMENT,
      sensitive: true,
    },
    resolved: { guildId, guildStatus: "active", moduleEnabled, tiers, entitlements },
    confirmed,
  });
  return { allowed: decision.allow && decision.code === "AUTHORIZED", code: decision.code, needsConfirmation: decision.needsConfirmation };
}

/**
 * Applies a plan through an injected executor:
 *   executor.createRole(data) -> { id }
 *   executor.createChannel(data) -> { id }
 * `rebuilt` must be a fresh plan for the same snapshot and guild. A mismatch
 * means the server changed after the preview and nothing is created.
 */
export async function applyServerClonePlan({ plan, token, rebuilt, executor }) {
  if (!plan || !rebuilt) throw new Error("Plan absent.");
  if (plan.token !== token || rebuilt.token !== token) {
    return { ok: false, code: "PLAN_STALE", createdRoles: 0, createdChannels: 0, failures: [] };
  }
  if (rebuilt.targetGuildId !== plan.targetGuildId) return { ok: false, code: "GUILD_MISMATCH", createdRoles: 0, createdChannels: 0, failures: [] };

  const failures = [];
  let consecutive = 0;
  let createdRoles = 0;
  let createdChannels = 0;
  // Existing items are mapped to their target ids up front.
  const roleMap = new Map(plan.existingRoleMap);
  const channelMap = new Map();
  const tripped = () => consecutive >= MAX_CONSECUTIVE_FAILURES;

  for (const role of plan.roles) {
    try {
      const created = await executor.createRole({
        name: role.name, colors: { primaryColor: role.color }, hoist: role.hoist, mentionable: role.mentionable,
        permissions: role.permissions, reason: "PND Server Clone",
      });
      roleMap.set(role.snapshotId, created.id);
      createdRoles += 1;
      consecutive = 0;
    } catch (error) {
      failures.push({ kind: "role", name: role.name, message: error instanceof Error ? error.message : "erreur" });
      consecutive += 1;
      if (tripped()) return { ok: false, code: "CIRCUIT_OPEN", createdRoles, createdChannels, failures };
    }
  }

  for (const channel of plan.channels) {
    try {
      const overwrites = channel.permissionOverwrites
        .map((overwrite) => {
          const targetId = overwrite.id === plan.sourceGuildId ? plan.targetGuildId : roleMap.get(overwrite.id);
          return targetId ? { id: targetId, type: 0, allow: overwrite.allow, deny: overwrite.deny } : null;
        })
        .filter(Boolean);
      let parent = null;
      if (channel.parentRef?.kind === "existing") parent = channel.parentRef.id;
      if (channel.parentRef?.kind === "create") parent = channelMap.get(channel.parentRef.id) ?? null;
      const created = await executor.createChannel({
        name: channel.name, type: channel.type, parent,
        topic: channel.topic, nsfw: channel.nsfw, rateLimitPerUser: channel.rateLimitPerUser,
        bitrate: channel.bitrate || undefined, userLimit: channel.userLimit || undefined,
        permissionOverwrites: overwrites, reason: "PND Server Clone",
      });
      channelMap.set(channel.snapshotId, created.id);
      createdChannels += 1;
      consecutive = 0;
    } catch (error) {
      failures.push({ kind: "channel", name: channel.name, message: error instanceof Error ? error.message : "erreur" });
      consecutive += 1;
      if (tripped()) return { ok: false, code: "CIRCUIT_OPEN", createdRoles, createdChannels, failures };
    }
  }

  return { ok: failures.length === 0, code: failures.length ? "PARTIAL" : "APPLIED", createdRoles, createdChannels, failures };
}

/** Discord.js adapter used by SYS+ commands and later by the slash handler. */
export function createDiscordCloneExecutor(guild) {
  return {
    createRole: (data) => guild.roles.create(data),
    createChannel: (data) => guild.channels.create(data),
  };
}

export const CLONE_DENIAL_MESSAGES = Object.freeze({
  ENTITLEMENT_MISSING: "Le pack **Server Tools** n'est pas activé sur ce serveur. Aucune structure n'a été modifiée.",
  TIER_INSUFFICIENT: "Réservé aux membres **SYS+**. Aucune structure n'a été modifiée.",
  CONFIRMATION_REQUIRED: "Confirmation requise : relance la commande `apply` avec le jeton du plan.",
  MODULE_DISABLED: "Le module Server Tools est désactivé sur ce serveur.",
});
