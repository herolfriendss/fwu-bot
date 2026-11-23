const REQUIRED_BOT_PERMISSIONS = ["ViewChannel", "SendMessages", "EmbedLinks"];

function hasAll(permissionSet, names) {
  return names.every((name) => permissionSet?.has?.(name) === true);
}

/** Select a text destination for a private-voice request when the native voice-chat
 * entry point is unavailable. Requests are routed to a shared authorized hub. */
export function chooseVoiceRequestDestination({ guild, voiceChannel, requester, bot, configuredChannelId = null }) {
  if (!guild || !voiceChannel || !requester || !bot) return null;
  const candidates = [];
  const channels = guild.channels?.cache;
  if (configuredChannelId) {
    const configured = channels?.get?.(configuredChannelId);
    if (configured) candidates.push(configured);
  }
  for (const channel of channels?.values?.() ?? []) {
    if (candidates.includes(channel)) continue;
    if (["demandes-vocales", "demandes-vocal", "voice-access-requests"].includes(String(channel.name).toLowerCase())) {
      candidates.push(channel);
    }
  }
  for (const channel of candidates) {
    if (channel.id === voiceChannel.id || !channel.isTextBased?.() || typeof channel.send !== "function") continue;
    const botPermissions = channel.permissionsFor?.(bot);
    const requesterPermissions = channel.permissionsFor?.(requester);
    if (!hasAll(botPermissions, REQUIRED_BOT_PERMISSIONS)) continue;
    if (requesterPermissions?.has?.("ViewChannel") !== true) continue;
    return channel;
  }
  return null;
}


/** Prevent a copied or replayed entry-point button from targeting another voice. */
export function isVoiceAccessEntryPointContext({
  customId,
  channelId,
  messageChannelId,
  messageAuthorId,
  botUserId,
}) {
  const match = typeof customId === "string"
    ? customId.match(/^vreq:start:(\d{5,25})$/)
    : null;
  if (!match || !botUserId || !messageAuthorId) return false;
  const targetChannelId = match[1];
  return channelId === targetChannelId
    && messageChannelId === targetChannelId
    && messageAuthorId === botUserId;
}
