export function assertSameVoice(
  memberVoiceChannelId: string | null,
  targetVoiceChannelId: string,
): void;

export function initialPlaylistVideos<T>(
  playlist: { page?: (pageNumber: number) => T[] } | null | undefined,
  limit: number,
): T[];

export type TrackTransition<T> =
  | { kind: "play"; track: T; current: T | null; queue: T[] }
  | { kind: "repeat"; track: T; current: T; queue: T[] }
  | { kind: "idle"; track: null; current: null; queue: T[] }
  | { kind: "reload-radio"; current: null; queue: T[] };

export function getNextTrackTransition<T>(state: {
  isRadio: boolean;
  loop: "off" | "track" | "queue";
  current: T | null;
  queue: T[];
}): TrackTransition<T>;

export function pauseAction(status: string, pausedStatus: string): "pause" | "resume";
