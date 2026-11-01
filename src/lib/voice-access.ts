import { z } from "zod";

const roles = z.array(z.string().regex(/^\d{5,25}$/)).max(250).transform((ids) => [...new Set(ids)]).nullable();
export const voiceAccessSchema = z.object({ panelRoleIds: roles, pvRoleIds: roles });
export type VoiceAccess = z.infer<typeof voiceAccessSchema>;
export const DEFAULT_VOICE_ACCESS: VoiceAccess = { panelRoleIds: null, pvRoleIds: null };