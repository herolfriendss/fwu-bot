export const REP_COOLDOWN_MS: number;
export function sanitizeBio(raw: unknown, max?: number): string;
export function sanitizeProfileColor(raw: unknown): string | null;
export function colorToInt(color: unknown): number | null;
export function repCooldownRemaining(lastGivenAt: unknown, now?: number, cooldownMs?: number): number;
export function canGiveRep(input: { giverId: string | null; targetId?: string | null; targetIsBot?: boolean }): { allowed: boolean; reason: string | null };
export function repBadge(count: number): string;
