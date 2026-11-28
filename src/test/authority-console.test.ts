import { describe, expect, it } from "vitest";
import { authorityDecisionInputSchema, authoritySyncSchema } from "@/lib/authority-console";

const request = {
  number: 1, permission: "voice.room.extra", label: "Salon vocal supplémentaire",
  requesterId: "300000000000000005", beneficiaryId: "300000000000000005",
  justification: "Soirée vocale", durationMs: 3_600_000, status: "pending", createdAt: 1, expiresAt: null, nonce: "n",
};

describe("AUTHORITY console shapes", () => {
  it("accepts a bounded bot sync and rejects unknown fields (no secret can slip in)", () => {
    expect(authoritySyncSchema.safeParse({ snapshots: [{ guildId: "111111111111111111", capturedAt: new Date().toISOString(), requests: [request] }], results: [] }).success).toBe(true);
    expect(authoritySyncSchema.safeParse({ snapshots: [{ guildId: "111111111111111111", capturedAt: new Date().toISOString(), requests: [{ ...request, signature: "x" }] }], results: [] }).success).toBe(false);
    expect(authoritySyncSchema.safeParse({ snapshots: [{ guildId: "abc", capturedAt: new Date().toISOString(), requests: [] }], results: [] }).success).toBe(false);
  });
  it("console decisions are limited to the registry's actions and bounds", () => {
    expect(authorityDecisionInputSchema.safeParse({ guildId: "111111111111111111", number: 1, action: "approve", nonce: "n" }).success).toBe(true);
    expect(authorityDecisionInputSchema.safeParse({ guildId: "111111111111111111", number: 1, action: "grant_role" }).success).toBe(false);
    expect(authorityDecisionInputSchema.safeParse({ guildId: "111111111111111111", number: 1, action: "extend", durationHours: 10_000 }).success).toBe(false);
  });
});
