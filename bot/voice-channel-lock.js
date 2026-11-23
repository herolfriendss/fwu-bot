const busyChannels = new Set();

/** Serializes permission and Voice Access mutations for one voice channel. */
export async function withVoiceChannelLock(channelId, action) {
  if (typeof channelId !== "string" || !/^\d{5,25}$/.test(channelId)) {
    throw new Error("Identifiant de salon vocal invalide.");
  }
  if (typeof action !== "function") throw new TypeError("Une action vocale est requise.");
  if (busyChannels.has(channelId)) {
    throw new Error("Une modification est déjà en cours dans ce vocal. Réessaie dans un instant.");
  }
  busyChannels.add(channelId);
  try {
    return await action();
  } finally {
    busyChannels.delete(channelId);
  }
}
