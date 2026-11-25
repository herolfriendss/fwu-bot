import { describe, expect, it } from "vitest";
import {
  buildPanelId, canManageTempVoice, clampEmptyDeleteSeconds, clampVoiceLimit, listAddRefusal, listOverwritePlan,
  parsePanelId, pickNextOwner, renameAllowed, renderVoiceName, tempVoiceNameIsValid, MAX_LIST_ENTRIES,
} from "../../bot/voice-v2-policy.js";

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

  it("clamps the empty-channel grace period between 0 and 300 seconds", () => {
    expect(clampEmptyDeleteSeconds(-1)).toBe(0);
    expect(clampEmptyDeleteSeconds(45.7)).toBe(45);
    expect(clampEmptyDeleteSeconds(9999)).toBe(300);
    expect(clampEmptyDeleteSeconds(undefined)).toBe(0);
  });

  it("allows two renames per ten minutes, like Discord", () => {
    const now = 1_000_000_000;
    expect(renameAllowed([], now).allowed).toBe(true);
    expect(renameAllowed([now - 1000], now).allowed).toBe(true);
    const blocked = renameAllowed([now - 60_000, now - 1000], now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAt).toBe(now - 60_000 + 10 * 60_000);
    expect(renameAllowed([now - 11 * 60_000, now - 1000], now).allowed).toBe(true);
  });

  it("hands ownership to the next human, never a bot", () => {
    expect(pickNextOwner([{ id: "bot", bot: true }, { id: "a" }, { id: "b" }], "old")).toBe("a");
    expect(pickNextOwner([{ id: "old" }, { id: "b" }], "old")).toBe("b");
    expect(pickNextOwner([{ id: "bot", bot: true }], "old")).toBeNull();
  });

  it("validates trusted/blocked list additions", () => {
    expect(listAddRefusal({ kind: "trusted", ownerId: "1", targetId: "2" })).toBeNull();
    expect(listAddRefusal({ kind: "trusted", ownerId: "1", targetId: "1" })).toMatch(/toi-même/);
    expect(listAddRefusal({ kind: "blocked", ownerId: "1", targetId: "2", targetIsBot: true })).toMatch(/bot/);
    expect(listAddRefusal({ kind: "blocked", ownerId: "1", targetId: "2", currentSize: MAX_LIST_ENTRIES })).toMatch(/pleine/);
    expect(listAddRefusal({ kind: "blocked", ownerId: "1", targetId: "2", currentSize: MAX_LIST_ENTRIES, alreadyListed: true })).toBeNull();
    expect(listAddRefusal({ kind: "other", ownerId: "1", targetId: "2" })).toMatch(/inconnue/);
  });

  it("never blocks a member who outranks the owner", () => {
    const plan = listOverwritePlan(
      [{ targetId: "t", kind: "trusted" }, { targetId: "low", kind: "blocked" }, { targetId: "high", kind: "blocked" }],
      { outranksOwner: (id) => id === "high" },
    );
    expect(plan).toEqual([{ id: "t", Connect: true, ViewChannel: true }, { id: "low", Connect: false }]);
  });

  it("round-trips panel component ids and rejects unknown ones", () => {
    expect(parsePanelId(buildPanelId("lock", "123456789012345678"))).toEqual({ action: "lock", channelId: "123456789012345678" });
    expect(parsePanelId("tvc:nuke:123456789012345678")).toBeNull();
    expect(parsePanelId("tvc:lock:abc")).toBeNull();
  });
});
