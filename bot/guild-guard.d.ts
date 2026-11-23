export function guildAllowed(guildId: string, allowlist?: string[] | null): boolean;
export function handleGuildCreate(guild: { id: string; leave(): Promise<unknown> }, allowlist?: string[] | null, record?: (code: string) => void): Promise<boolean>;
export function enforceGuildAllowlist(
  client: { guilds: { cache: Map<string, { id: string; leave(): Promise<unknown> }> } },
  allowlist?: string[] | null,
  record?: (code: string) => void,
): Promise<number>;
export function handleGuildGuardJoin(
  member: {
    id: string;
    user: { bot: boolean; tag: string; createdAt: Date };
    guild: unknown;
    kick(reason: string): Promise<unknown>;
  },
  guard: {
    enabled: boolean;
    minAccountAgeDays: number;
    youngAccountAction: "log" | "kick" | "quarantine";
    quarantineRoleId: string | null;
    logChannelId: string | null;
    raidJoinThreshold: number;
    raidWindowSeconds: number;
    lockdown: boolean;
  },
  record?: (code: string) => void,
): Promise<boolean>;
export function resetGuildGuardState(guildId?: string | null): void;
export function guardLogEmbed(input: unknown): unknown;
export function accountAgeDays(createdAt: unknown, now?: number): number;
export function evaluateJoin(input: unknown): { action: "allow" | "log" | "kick" | "quarantine"; reason: string | null };
export function guardReason(reason: string, minimum: number): string;
export function parseGuildAllowlist(raw: unknown): string[];
export function raidTriggered(timestamps: number[], now: number, windowMs: number, threshold: number): boolean;
