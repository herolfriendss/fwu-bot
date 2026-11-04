export function renderVoiceName(template: unknown, displayName: unknown): string;
export function clampVoiceLimit(raw: unknown): number;
export function canManageTempVoice(input: { ownerId: string; userId: string | null; hasManageChannels?: boolean }): boolean;
export function tempVoiceNameIsValid(raw: unknown): boolean;
