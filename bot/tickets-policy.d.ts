export function sanitizeTicketSubject(raw: unknown, max?: number): string;
export function ticketChannelName(username: unknown, userId: unknown): string;
export function ticketOpenAllowed(openCount: number, maxOpenPerUser: number): boolean;
export function canActOnTicket(input: { actorId: string | null; ticketUserId: string; claimedBy?: string | null; isStaff?: boolean }): boolean;
export function ticketStatusLabel(status: string): string;
export function ticketDuration(createdAt: number, now?: number): string;
export function ticketSetupIssue(settings: unknown): string | null;
