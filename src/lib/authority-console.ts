import { z } from "zod";

// AUTHORITY in the console: shapes shared by the bot sync route, the console API and the page.
// The bot's SQLite registry stays the source of truth; nothing here grants an exception.
export const AUTHORITY_ACTIONS = ["approve", "refuse", "suspend", "resume", "revoke", "extend"] as const;
const snowflake = z.string().regex(/^\d{5,25}$/);

export const authorityRequestSchema = z.object({
  number: z.number().int().min(1),
  permission: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  requesterId: snowflake,
  beneficiaryId: snowflake,
  justification: z.string().max(500),
  durationMs: z.number().int().min(0),
  status: z.enum(["pending", "refused", "active", "suspended", "expired", "revoked"]),
  createdAt: z.number().int(),
  expiresAt: z.number().int().nullable(),
  // Present only while pending: required to approve or refuse (single use, rotated after).
  nonce: z.string().max(64).nullable(),
}).strict();

export const authoritySnapshotSchema = z.object({
  guildId: snowflake,
  capturedAt: z.string().datetime(),
  requests: z.array(authorityRequestSchema).max(200),
}).strict();

export const authorityResultSchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  result: z.string().max(200),
}).strict();

export const authoritySyncSchema = z.object({
  snapshots: z.array(authoritySnapshotSchema).max(10),
  results: z.array(authorityResultSchema).max(50),
}).strict();

export const authorityDecisionInputSchema = z.object({
  guildId: snowflake,
  number: z.number().int().min(1),
  action: z.enum(AUTHORITY_ACTIONS),
  nonce: z.string().max(64).nullable().optional(),
  durationHours: z.number().int().min(1).max(720).nullable().optional(),
}).strict();

export type AuthoritySnapshot = z.infer<typeof authoritySnapshotSchema>;
export type AuthoritySync = z.infer<typeof authoritySyncSchema>;
export type AuthorityDecisionInput = z.infer<typeof authorityDecisionInputSchema>;
export type PendingDecision = { id: string; guildId: string; number: number; action: string; nonce: string | null; durationMs: number | null };
