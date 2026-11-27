export const COMMAND_MAX_AGE_MS: number;
export function decideRemoteCommand(
  body: unknown,
  options?: { now?: number; seen?: Set<string>; enabled?: boolean },
): null | { action: "restart"; id: string } | { action: "ignore"; reason: string };
