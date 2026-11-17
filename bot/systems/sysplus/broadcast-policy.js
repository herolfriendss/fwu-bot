import { ChannelType, PermissionFlagsBits } from "discord.js";

export const WAKEUP_MAX_CHANNELS = 8;
export const WAKEUP_HOP_DELAY_MS = 2_500;
export const WAKEUP_TARGET_COOLDOWN_MS = 30 * 60_000;
export const DM_CAMPAIGN_DELAY_MS = 2_500;
export const DM_CAMPAIGN_COOLDOWN_MS = 15 * 60_000;
export const DM_CAMPAIGN_MAX_RECIPIENTS = 500;

export function parseDmAllOwnerIds(value = "") {
  return new Set(String(value).split(/[;,\s]+/).map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id)));
}

export function isDmAllOwner(userId, configuredIds = process.env.DM_ALL_OWNER_IDS ?? "") {
  return parseDmAllOwnerIds(configuredIds).has(String(userId ?? ""));
}

/** Only ordinary public voice channels may be used by the opt-in wakeup route. */
export function isEligibleWakeupChannel(channel, { guildId, everyoneRole, tempChannelIds = new Set(), targetMember, botMember } = {}) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (!guildId || channel.guildId !== guildId || tempChannelIds.has(channel.id)) return false;
  try {
    if (!channel.permissionsFor(everyoneRole)?.has(PermissionFlagsBits.Connect)) return false;
    if (!channel.permissionsFor(targetMember)?.has(PermissionFlagsBits.Connect)) return false;
    const botPermissions = channel.permissionsFor(botMember);
    return Boolean(botPermissions?.has(PermissionFlagsBits.Connect) && botPermissions?.has(PermissionFlagsBits.MoveMembers));
  } catch {
    return false;
  }
}