export function assertSameVoice(userChannelId, botChannelId) {
  if (!userChannelId || (botChannelId && userChannelId !== botChannelId)) {
    throw new Error("Tu dois être dans le même salon vocal que le bot.");
  }
}

/**
 * Use only the playlist page already loaded by play-dl. Calling all_videos()
 * fetches every continuation page even when the queue has a strict cap.
 */
export function initialPlaylistVideos(playlist, limit) {
  const max = Math.floor(Number(limit));
  if (!Number.isFinite(max) || max <= 0) return [];
  const firstPage = playlist?.page?.(1);
  return Array.isArray(firstPage) ? firstPage.slice(0, max) : [];
}

export function getNextTrackTransition({ isRadio, loop, current, queue }) {
  if (!isRadio && loop === "track" && current) {
    return { kind: "repeat", track: current, current, queue: [...queue] };
  }

  const nextQueue = [...queue];
  if (!isRadio && current && loop === "queue") nextQueue.push(current);
  if (isRadio && nextQueue.length === 0) {
    return { kind: "reload-radio", current: null, queue: nextQueue };
  }

  const track = nextQueue.shift() ?? null;
  return {
    kind: track ? "play" : "idle",
    track,
    current: null,
    queue: nextQueue,
  };
}

export function pauseAction(status, pausedStatus) {
  return status === pausedStatus ? "resume" : "pause";
}
