export function parseGuildAllowlist(raw: unknown): string[];
export function accountAgeDays(createdAt: unknown, now?: number): number;
export function raidTriggered(timestamps: number[], now: number, windowMs: number, threshold: number): boolean;
export function evaluateJoin(input: {
  createdAt: unknown;
  now?: number;
  guard?: {
    enabled?: boolean;
    minAccountAgeDays?: number;
    youngAccountAction?: "log" | "kick" | "quarantine";
    quarantineRoleId?: string | null;
    lockdown?: boolean;
  } | null;
  raidMode?: boolean;
}): { action: "allow" | "log" | "kick" | "quarantine"; reason: string | null };
export function guardReason(reason: string, minimum: number): string;
