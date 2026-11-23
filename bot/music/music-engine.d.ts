export type PlaybackTrack = { title?: string; [key: string]: unknown };

export type PlaybackState<T extends PlaybackTrack = PlaybackTrack> = {
  radio: { playlistUrl?: string } | null | undefined;
  loop: "off" | "track" | "queue";
  current: T | null;
  queue: T[];
  advancing: boolean;
};

export type PlaybackDependencies<T extends PlaybackTrack = PlaybackTrack> = {
  playTrack(track: T): Promise<void>;
  reloadRadio(): Promise<T[]>;
  notify(event: "track_started", track: T): Promise<unknown>;
  notify(event: "track_failed", track: T): Promise<unknown>;
  notify(event: "track_failed" | "radio_reload_failed"): Promise<unknown>;
  updatePanel(): Promise<unknown>;
  log(event: "repeat_failed" | "track_failed" | "radio_reload_failed"): void;
  scheduleAdvance(): void;
  scheduleRadioRetry(): void;
};

export function awaitVoiceReady<T extends { destroy(): unknown }>(
  state: { connection: T | null },
  connection: T,
  waitForReady: () => Promise<unknown>,
): Promise<void>;

export function scheduleConfiguredRadioRetry(
  state: { radio: object | null | undefined },
  config: object,
  schedule: (callback: () => void, delay: number) => unknown,
  onRetry: (isCurrent: boolean) => unknown,
  delay?: number,
): boolean;

export function advancePlayback<T extends PlaybackTrack>(
  state: PlaybackState<T>,
  dependencies: PlaybackDependencies<T>,
): Promise<boolean>;
