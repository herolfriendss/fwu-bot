import { parsePndOwnerIds } from "./pnd-owner-policy.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";

/** PND Intelligence is available only in the configured, enabled SYS+ channel. */
export function canUsePndIntelligence({ guildId, channelId, enabled, configuredChannelId, member, sysPlusRoleId, ownerIds }) {
  if (!guildId || !channelId || enabled !== true || !configuredChannelId || channelId !== configuredChannelId || !member?.id) return false;
  return isSysPlus(member, sysPlusRoleId) || parsePndOwnerIds(ownerIds).includes(member.id);
}
