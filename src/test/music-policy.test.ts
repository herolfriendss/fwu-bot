import { describe, expect, it, vi } from "vitest";
import {
  assertSameVoice,
  getNextTrackTransition,
  initialPlaylistVideos,
  pauseAction,
} from "../../bot/music/music-policy.js";
import {
  advancePlayback,
  awaitVoiceReady,
  scheduleConfiguredRadioRetry,
} from "../../bot/music/music-engine.js";

describe("music voice controls", () => {
  it("clears and destroys a connection that never reaches Ready", async () => {
    const connection = { destroy: vi.fn() };
    const state = { connection };
    const failure = new Error("voice ready timeout");

    await expect(
      awaitVoiceReady(state, connection, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(state.connection).toBeNull();
    expect(connection.destroy).toHaveBeenCalledOnce();
  });

  it("does not clear a newer connection when an older readiness wait fails", async () => {
    const oldConnection = { destroy: vi.fn() };
    const currentConnection = { destroy: vi.fn() };
    const state = { connection: currentConnection };

    await expect(
      awaitVoiceReady(state, oldConnection, async () => {
        throw new Error("stale readiness failure");
      }),
    ).rejects.toThrow("stale readiness failure");

    expect(state.connection).toBe(currentConnection);
    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(currentConnection.destroy).not.toHaveBeenCalled();
  });

  it("retains a connection that reaches Ready", async () => {
    const connection = { destroy: vi.fn() };
    const state = { connection };
    await expect(awaitVoiceReady(state, connection, async () => {})).resolves.toBeUndefined();
    expect(state.connection).toBe(connection);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("retries a persisted radio only while its guild configuration is current", () => {
    const config = { streamUrl: "https://audio.example.org/live" };
    const schedule = vi.fn((callback: () => void) => callback());
    const onRetry = vi.fn();
    const state: { radio: typeof config | null } = { radio: config };

    expect(scheduleConfiguredRadioRetry(state, config, schedule, onRetry, 30_000)).toBe(true);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(true);

    state.radio = null;
    expect(scheduleConfiguredRadioRetry(state, config, schedule, onRetry)).toBe(false);
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("allows controls only from the bot's current voice channel", () => {
    expect(() => assertSameVoice("voice-a", "voice-a")).not.toThrow();
    expect(() => assertSameVoice("voice-b", "voice-a")).toThrow("même salon vocal");
    expect(() => assertSameVoice(null, "voice-a")).toThrow("même salon vocal");
  });

  it("caps a playlist to its already loaded first page without fetching all pages", () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: `video-${index + 1}` }));
    const playlist = {
      page: vi.fn((pageNumber: number) => (pageNumber === 1 ? page : [])),
      all_videos: vi.fn(() => {
        throw new Error("must not fetch playlist continuations");
      }),
    };

    expect(initialPlaylistVideos(playlist, 25)).toHaveLength(25);
    expect(playlist.page).toHaveBeenCalledExactlyOnceWith(1);
    expect(playlist.all_videos).not.toHaveBeenCalled();
    expect(initialPlaylistVideos(playlist, 100)).toHaveLength(100);
  });

  it("returns no playlist videos for an invalid queue limit", () => {
    const page = vi.fn(() => [{ id: "video-1" }]);
    expect(initialPlaylistVideos({ page }, 0)).toEqual([]);
    expect(page).not.toHaveBeenCalled();
  });

  it("moves to the next queued track after a playback failure", () => {
    const failed = { title: "failed" };
    const next = { title: "next" };
    const transition = getNextTrackTransition({
      isRadio: false,
      loop: "off",
      current: failed,
      queue: [next],
    });

    expect(transition).toEqual({
      kind: "play",
      track: next,
      current: null,
      queue: [],
    });
  });

  it("preserves track/queue repeat and reloads a drained radio queue", () => {
    const current = { title: "current" };
    const queued = { title: "queued" };
    expect(
      getNextTrackTransition({
        isRadio: false,
        loop: "track",
        current,
        queue: [queued],
      }),
    ).toEqual({ kind: "repeat", track: current, current, queue: [queued] });

    expect(
      getNextTrackTransition({
        isRadio: false,
        loop: "queue",
        current,
        queue: [queued],
      }),
    ).toEqual({
      kind: "play",
      track: queued,
      current: null,
      queue: [current],
    });

    expect(
      getNextTrackTransition({
        isRadio: true,
        loop: "off",
        current,
        queue: [],
      }),
    ).toEqual({ kind: "reload-radio", current: null, queue: [] });
  });

  it("maps pause button transitions without a Discord player", () => {
    expect(pauseAction("playing", "paused")).toBe("pause");
    expect(pauseAction("paused", "paused")).toBe("resume");
  });

  it("recovers from a failed stream and attempts the following queued track", async () => {
    const failed = { title: "unavailable" };
    const next = { title: "next" };
    const state = {
      radio: null,
      loop: "off" as const,
      current: { title: "previous" },
      queue: [failed, next],
      advancing: false,
    };
    const retry: Array<() => Promise<boolean>> = [];
    const playTrack = vi.fn(async (track: { title: string }) => {
      if (track === failed) throw new Error("simulated stream failure");
    });
    const dependencies = {
      playTrack,
      reloadRadio: vi.fn(async () => []),
      notify: vi.fn(async () => {}),
      updatePanel: vi.fn(async () => {}),
      log: vi.fn(),
      scheduleAdvance: vi.fn(),
      scheduleRadioRetry: vi.fn(),
    };

    dependencies.scheduleAdvance.mockImplementation(() => {
      retry.push(() => advancePlayback(state, dependencies));
    });

    await advancePlayback(state, dependencies);
    expect(state.current).toBeNull();
    expect(state.queue).toEqual([next]);
    expect(dependencies.log).toHaveBeenCalledWith("track_failed");
    expect(dependencies.notify).toHaveBeenCalledWith("track_failed", failed);
    expect(retry).toHaveLength(1);

    const retryPlayback = retry[0];
    if (!retryPlayback) throw new Error("A retry callback should have been queued.");
    await retryPlayback();
    expect(playTrack).toHaveBeenLastCalledWith(next);
    expect(dependencies.notify).toHaveBeenCalledWith("track_started", next);
  });

  it("schedules radio retry when the playlist cannot be reloaded", async () => {
    const state = {
      radio: { playlistUrl: "https://radio.example/playlist" },
      loop: "off" as const,
      current: null,
      queue: [],
      advancing: false,
    };
    const dependencies = {
      playTrack: vi.fn(async () => {}),
      reloadRadio: vi.fn(async () => {
        throw new Error("simulated network outage");
      }),
      notify: vi.fn(async () => {}),
      updatePanel: vi.fn(async () => {}),
      log: vi.fn(),
      scheduleAdvance: vi.fn(),
      scheduleRadioRetry: vi.fn(),
    };

    await advancePlayback(state, dependencies);
    expect(dependencies.log).toHaveBeenCalledWith("radio_reload_failed");
    expect(dependencies.notify).toHaveBeenCalledWith("radio_reload_failed");
    expect(dependencies.scheduleRadioRetry).toHaveBeenCalledOnce();
    expect(dependencies.playTrack).not.toHaveBeenCalled();
    expect(state.advancing).toBe(false);
  });
});
