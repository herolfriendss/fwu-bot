import { PermissionFlagsBits } from "discord.js";
import { isWhitelistMember } from "./systems/sysplus/whitelist-policy.js";
import { authorize } from "./platform/policy/authorize.js";

/** Native Discord moderation permission and the configured internal exemption stay separate. */
export function shouldApplySpamLimit(member, whitelistRoleId) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageMessages)) return false;
  const guildId = member.guild?.id;
  if (!guildId) return true;
  // Without an actor id the quota decision cannot be scoped by authorize(); the
  // configured WHITELIST role is still an explicit quota exemption, so honor it
  // here and otherwise keep the limit applied (fail closed).
  if (!member.id) return !isWhitelistMember(member, whitelistRoleId);
  const decision = authorize({
    guildId,
    actor: { id: member.id },
    actionPolicy: { key: "spam.rate_limit" },
    resolved: {
      guildId,
      guildStatus: "active",
      moduleEnabled: true,
      quotaExceeded: true,
      whitelist: isWhitelistMember(member, whitelistRoleId),
    },
  });
  return decision.code === "LIMIT_REACHED";
}

export function exceedsMentionLimit({ users = 0, roles = 0, everyone = false } = {}, maximum = 5) {
  const count = Math.max(0, Math.floor(Number(users) || 0))
    + Math.max(0, Math.floor(Number(roles) || 0))
    + (everyone ? 1 : 0);
  const threshold = Math.max(1, Math.floor(Number(maximum) || 5));
  return count > threshold;
}
