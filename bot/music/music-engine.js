import { getNextTrackTransition } from "./music-policy.js";

export async function awaitVoiceReady(state, connection, waitForReady) {
  try {
    await waitForReady();
  } catch (error) {
    if (state.connection === connection) state.connection = null;
    connection.destroy();
    throw error;
  }
}

export function scheduleConfiguredRadioRetry(state, config, schedule, onRetry, delay = 30_000) {
  if (state.radio !== config) return false;
  schedule(() => onRetry(state.radio === config), delay);
  return true;
}

export async function advancePlayback(state, dependencies) {
  if (state.advancing) return false;
  state.advancing = true;

  try {
    const previous = state.current;
    const transition = getNextTrackTransition({
      isRadio: Boolean(state.radio),
      loop: state.loop,
      current: state.current,
      queue: state.queue,
    });
    state.queue = transition.queue;
    state.current = transition.current;

    if (transition.kind === "repeat") {
      try {
        await dependencies.playTrack(transition.track);
      } catch {
        state.current = null;
        state.loop = "off";
        dependencies.log("repeat_failed");
        dependencies.scheduleAdvance();
      }
      return true;
    }

    if (transition.kind === "reload-radio") {
      try {
        const tracks = await dependencies.reloadRadio();
        if (!tracks.length) throw new Error("radio_empty");
        state.queue.push(...tracks);
      } catch {
        dependencies.log("radio_reload_failed");
        await dependencies.notify("radio_reload_failed").catch(() => {});
        dependencies.scheduleRadioRetry();
        return true;
      }
    }

    let next = transition.kind === "play" ? transition.track : state.queue.shift();
    // Autoplay: the queue is empty after a normal track -> fetch a similar one.
    if (!next && previous && !state.radio && dependencies.autoplay) {
      next = await dependencies.autoplay(previous).catch(() => null);
      if (next) state.current = null;
    }
    if (!next) {
      await dependencies.updatePanel().catch(() => {});
      return true;
    }

    try {
      await dependencies.playTrack(next);
      await dependencies.notify("track_started", next).catch(() => {});
    } catch {
      dependencies.log("track_failed");
      await dependencies.notify("track_failed", next).catch(() => {});
      state.current = null;
      dependencies.scheduleAdvance();
    }
    return true;
  } finally {
    state.advancing = false;
  }
}
