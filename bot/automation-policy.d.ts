export const AUTOMATION_MIN_INTERVAL: number;
export const AUTOMATION_MAX_INTERVAL: number;
export const AUTOMATION_MAX_CONTENT: number;
export function clampInterval(raw: unknown): number;
export function sanitizeAutomationContent(raw: unknown, max?: number): string;
export function renderAutomation(template: unknown, values?: { server?: string; user?: string }): string;
export function nextRunAt(now: number, intervalMinutes: unknown): number;
export function isDue(nextRun: unknown, now?: number): boolean;
export function autoRolePlan(roleIds: string[] | null | undefined, options?: {
  botPosition?: number;
  rolePositions?: Record<string, number>;
  memberRoleIds?: string[];
}): { applicable: string[]; skipped: { roleId: string; reason: string }[] };
