/**
 * Shared PND V5 authorization decision engine.
 *
 * Callers MUST provide freshly resolved guild/member/role/permission state.
 * This pure module deliberately has no Discord or database dependency so the
 * same rules can be exercised by slash, prefix, component and API adapters.
 */

const VALID_TIERS = new Set([
  "PND_OWNER",
  "GUILD_OWNER",
  "SYS_PLUS",
  "ADMIN_PLUS",
  "STAFF",
  "MEMBER",
  "AI",
]);

const AI_NEVER_ALLOWED = new Set([
  "owner.manage",
  "sysplus.manage",
  "adminplus.manage",
  "whitelist.manage",
  "prime.manage",
  "license.manage",
  "entitlement.manage",
  "economy.owner_adjust",
  "backup.restore",
  "bot.self_configure",
  "moderation.ban",
  "moderation.kick",
  "moderation.mute",
]);

const uniqueStrings = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item))] : [];

function result(allow, code, details = {}) {
  return Object.freeze({
    allow,
    code,
    needsConfirmation: Boolean(details.needsConfirmation),
    audit: Object.freeze({
      decision: allow ? "allow" : "deny",
      code,
      guildId: details.guildId ?? null,
      actorId: details.actorId ?? null,
      action: details.action ?? null,
      targetId: details.targetId ?? null,
    }),
  });
}

/**
 * @param {object} input
 * @param {string} input.guildId
 * @param {object} input.actor Fresh identity: { id, kind?, onBehalfOf? }
 * @param {object} input.resolved Fresh server-side facts:
 *   { guildId, guildStatus, moduleEnabled, entitlements, tiers,
 *     permissions, botPermissions, adminScopes, quotaExceeded,
 *     whitelist, actorRolePosition, targetRolePosition,
 *     botRolePosition, targetId }
 * @param {object} input.actionPolicy { key, minTiers, scope, entitlement,
 *   requiredPermissions, botRequiredPermissions, sensitive,
 *   allowScopeBypassTiers, aiTools }
 * @param {boolean} [input.confirmed]
 */
export function authorize(input = {}) {
  const guildId = typeof input.guildId === "string" ? input.guildId : null;
  const actor = input.actor ?? {};
  const policy = input.actionPolicy ?? {};
  const state = input.resolved ?? {};
  const actorId = typeof actor.id === "string" ? actor.id : null;
  const action = typeof policy.key === "string" ? policy.key : null;
  const targetId = typeof state.targetId === "string" ? state.targetId : null;
  const meta = { guildId, actorId, action, targetId };
  const deny = (code) => result(false, code, meta);

  if (!guildId || !actorId || !action) return deny("INVALID_CONTEXT");
  if (state.guildId !== guildId) return deny("GUILD_MISMATCH");
  if (state.guildStatus !== "active") return deny("GUILD_NOT_AUTHORIZED");
  if (state.moduleEnabled === false) return deny("MODULE_DISABLED");

  if (policy.entitlement && !uniqueStrings(state.entitlements).includes(policy.entitlement)) {
    return deny("ENTITLEMENT_MISSING");
  }

  const tiers = uniqueStrings(state.tiers).filter((tier) => VALID_TIERS.has(tier));
  const isAi = actor.kind === "ai" || tiers.includes("AI");
  if (isAi) {
    if (AI_NEVER_ALLOWED.has(action)) return deny("AI_ACTION_FORBIDDEN");
    const allowedTools = uniqueStrings(policy.aiTools);
    if (!allowedTools.includes(action)) return deny("AI_TOOL_NOT_ALLOWED");
    if (!actor.onBehalfOf || actor.onBehalfOf !== state.resolvedUserId) {
      return deny("AI_DELEGATION_INVALID");
    }
    // AI rights are the intersection of the delegated user's rights and the
    // bot's native permissions. AI itself is never treated as a privileged tier.
    if (!state.delegatedUserAuthorized) return deny("AI_DELEGATED_USER_DENIED");
  }

  const requiredCapabilities = uniqueStrings(policy.requiredCapabilities);
  const capabilities = new Set(uniqueStrings(state.capabilities));
  if (requiredCapabilities.some((capability) => !capabilities.has(capability))) {
    return deny("CAPABILITY_DENIED");
  }

  const minTiers = uniqueStrings(policy.minTiers);
  if (minTiers.length && !minTiers.some((tier) => tiers.includes(tier))) {
    return deny("TIER_INSUFFICIENT");
  }

  if (policy.scope) {
    const bypassTiers = uniqueStrings(policy.allowScopeBypassTiers);
    const canBypass = bypassTiers.some((tier) => tiers.includes(tier));
    if (!canBypass && !uniqueStrings(state.adminScopes).includes(policy.scope)) {
      return deny("SCOPE_DENIED");
    }
  }

  const actorPermissions = new Set(uniqueStrings(state.permissions));
  for (const permission of uniqueStrings(policy.requiredPermissions)) {
    if (!actorPermissions.has(permission)) return deny("DISCORD_PERMISSION");
  }

  const botPermissions = new Set(uniqueStrings(state.botPermissions));
  for (const permission of uniqueStrings(policy.botRequiredPermissions)) {
    if (!botPermissions.has(permission)) return deny("BOT_PERMISSION");
  }

  if (policy.requireHierarchy) {
    const actorPosition = Number(state.actorRolePosition);
    const targetPosition = Number(state.targetRolePosition);
    const botPosition = Number(state.botRolePosition);
    if (
      !Number.isFinite(actorPosition) ||
      !Number.isFinite(targetPosition) ||
      !Number.isFinite(botPosition) ||
      actorPosition <= targetPosition ||
      botPosition <= targetPosition
    ) {
      return deny("HIERARCHY");
    }
  }

  // WHITELIST only exempts internal quotas. It does not change tiers,
  // scopes, native permissions, hierarchy or entitlements.
  if (state.quotaExceeded && !state.whitelist) return deny("LIMIT_REACHED");

  if (policy.sensitive && input.confirmed !== true) {
    return result(true, "CONFIRMATION_REQUIRED", { ...meta, needsConfirmation: true });
  }

  return result(true, "AUTHORIZED", meta);
}

export const AI_FORBIDDEN_ACTIONS = Object.freeze([...AI_NEVER_ALLOWED]);
export const AUTHORIZATION_TIERS = Object.freeze([...VALID_TIERS]);
