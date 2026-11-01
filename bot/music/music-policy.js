export function assertSameVoice(userChannelId, botChannelId) {
  if (!userChannelId || (botChannelId && userChannelId !== botChannelId)) {
    throw new Error("Tu dois être dans le même salon vocal que le bot.");
  }
}
