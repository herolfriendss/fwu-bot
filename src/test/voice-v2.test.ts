import { describe, expect, it } from "vitest";
import { canManageTempVoice, clampVoiceLimit, renderVoiceName, tempVoiceNameIsValid } from "../../bot/voice-v2-policy.js";

describe("vocal V2 policy", () => {
  it("renders a safe channel name from the template", () => {
    expect(renderVoiceName("Salon de {user}", "Ryan")).toBe("Salon de Ryan");
    expect(renderVoiceName("  {user}\n  ", "  Ryan  ")).toBe("Ryan");
    expect(renderVoiceName("", "")).toBe("Salon de Membre");
    expect(renderVoiceName("{user}", "x".repeat(200)).length).toBeLessThanOrEqual(100);
  });

  it("clamps user limits between 0 and 99", () => {
    expect(clampVoiceLimit(-5)).toBe(0);
    expect(clampVoiceLimit(12.9)).toBe(12);
    expect(clampVoiceLimit(150)).toBe(99);
    expect(clampVoiceLimit("abc")).toBe(0);
  });

  it("lets only the owner or staff manage a temporary channel", () => {
    expect(canManageTempVoice({ ownerId: "1", userId: "1" })).toBe(true);
    expect(canManageTempVoice({ ownerId: "1", userId: "2", hasManageChannels: true })).toBe(true);
    expect(canManageTempVoice({ ownerId: "1", userId: "2" })).toBe(false);
    expect(canManageTempVoice({ ownerId: "1", userId: null })).toBe(false);
  });

  it("rejects empty or multiline channel names", () => {
    expect(tempVoiceNameIsValid("Salon")).toBe(true);
    expect(tempVoiceNameIsValid("")).toBe(false);
    expect(tempVoiceNameIsValid("a\nb")).toBe(false);
  });
});
