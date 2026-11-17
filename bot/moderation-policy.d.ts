export function parseDuration(raw: unknown): number | null;
export function hasPermission(bitfield: string | bigint, bit: string | bigint): boolean;
export function canModerate(input: {
  actorId: string | null;
  targetId: string | null;
  guildOwnerId: string;
  actorPermissions: string | bigint;
  targetPermissions?: string | bigint;
  actorPosition?: number;
  targetPosition?: number;
  botPosition?: number;
  requiredBit: string | bigint;
}): { allowed: boolean; reason: string | null };
export function warningExpiry(now: number, days: number): number | null;
export function activeWarnings<T extends { expires_at?: number | null }>(warnings: T[], now?: number): T[];
export function verificationEligible(createdAt: unknown, now: number, minAccountAgeDays: number): { eligible: boolean; reason: string | null };
export function sanitizeReason(raw: unknown, max?: number): string;
export function formatDuration(minutes: number): string;
