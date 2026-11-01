import { describe, expect, it } from "vitest";
import { aiErrorMessage, formatAuditEntry, parseIncidentInput, snowflakeDate } from "@/lib/incident-shared";

describe("incident advisor input", () => {
  it("rejects descriptions shorter than 10 characters", () => {
    expect(() => parseIncidentInput({ guildId: "123456789012345678", description: "trop court" .slice(0, 9) })).toThrow();
  });

  it("rejects descriptions longer than 3000 characters", () => {
    expect(() => parseIncidentInput({ guildId: "123456789012345678", description: "a".repeat(3001) })).toThrow();
  });

  it("rejects a malformed server id", () => {
    expect(() => parseIncidentInput({ guildId: "../users/@me", description: "Un membre spamme le salon" })).toThrow();
  });

  it("accepts and trims a valid description", () => {
    expect(parseIncidentInput({ guildId: "123456789012345678", description: "  Un membre spamme le salon  " })).toEqual({
      guildId: "123456789012345678",
      description: "Un membre spamme le salon",
    });
  });
});

describe("audit log formatting", () => {
  it("decodes the date from a Discord snowflake", () => {
    // Example id from Discord's documentation: 2016-04-30 11:18:25.796 UTC
    expect(snowflakeDate("175928847299117063").toISOString()).toBe("2016-04-30T11:18:25.796Z");
  });

  it("names the moderator, target and reason", () => {
    const names = new Map([["1", "Modo"], ["2", "Pseudo123"]]);
    const line = formatAuditEntry({ id: "175928847299117063", action_type: 22, user_id: "1", target_id: "2", reason: "spam" }, names);
    expect(line).toBe("2016-04-30 11:18 UTC | Membre banni | par Modo | cible Pseudo123 | raison : spam");
  });
});

describe("AI error messages", () => {
  it("points to credits on 402", () => {
    expect(aiErrorMessage(402)).toContain("Plans & crédits");
  });
});
