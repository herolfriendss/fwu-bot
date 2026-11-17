import { describe, expect, it } from "vitest";
import { containsBannedWord, matchKeyword, sanitizeSettings, sanitizeSettingsForGuild } from "@/lib/bot-settings";

describe("bot settings", () => {
  it("never accepts @everyone as a staff, protected or SYS+ role", () => {
    const guildId = "1234567890123";
    const settings = sanitizeSettingsForGuild({
      sysPlus: { roleId: guildId },
      moderation: {
        protectRoleId: guildId,
        staffRoleIds: [guildId, "1234567890124"],
        untouchableRoleIds: [guildId, "1234567890125"],
      },
    }, guildId);

    expect(settings.sysPlus.roleId).toBeNull();
    expect(settings.moderation.protectRoleId).toBeNull();
    expect(settings.moderation.staffRoleIds).toEqual(["1234567890124"]);
    expect(settings.moderation.untouchableRoleIds).toEqual(["1234567890125"]);
  });
  it("rejects @everyone from every configurable role field", () => {
    const guildId = "1234567890123";
    const validRoleId = "1234567890124";
    const settings = sanitizeSettingsForGuild({
      guildGuard: { quarantineRoleId: guildId },
      verification: { roleId: guildId },
      tickets: { supportRoleId: guildId },
      automation: { autoRoleIds: [guildId, validRoleId] },
    }, guildId);

    expect(settings.guildGuard.quarantineRoleId).toBeNull();
    expect(settings.verification.roleId).toBeNull();
    expect(settings.tickets.supportRoleId).toBeNull();
    expect(settings.automation.autoRoleIds).toEqual([validRoleId]);
  });

  it("syncs separate role restrictions for =panel and =pv", () => {
    expect(sanitizeSettings({ voiceAccess: { panelRoleIds: ["11111"], pvRoleIds: ["22222"] } }).voiceAccess).toEqual({ panelRoleIds: ["11111"], pvRoleIds: ["22222"] });
    expect(sanitizeSettings({}).voiceAccess).toEqual({ panelRoleIds: null, pvRoleIds: null });
    expect(sanitizeSettings({ voiceAccess: { panelRoleIds: [], pvRoleIds: [] } }).voiceAccess).toEqual({ panelRoleIds: [], pvRoleIds: [] });
  });
  it("keyword matches whole words only", () => {
    const rules = [{ trigger: "salut", response: "Hey", exact: false }];
    expect(matchKeyword(rules, "Salut tout le monde")).toBe("Hey");
    expect(matchKeyword(rules, "salutations")).toBeNull();
  });
  it("exact keyword needs the whole message", () => {
    const rules = [{ trigger: "!regles", response: "R", exact: true }];
    expect(matchKeyword(rules, "!regles")).toBe("R");
    expect(matchKeyword(rules, "voir !regles")).toBeNull();
  });
  it("banned word detection ignores word fragments", () => {
    expect(containsBannedWord(["con"], "espèce de con !")).toBe(true);
    expect(containsBannedWord(["con"], "content")).toBe(false);
  });
  it("clamps spam limits and drops invalid channel ids", () => {
    const s = sanitizeSettings({ spam: { maxMessages: 999, perSeconds: 0, timeoutMinutes: 5 }, welcome: { channelId: "abc" } });
    expect(s.spam.maxMessages).toBe(30);
    expect(s.spam.perSeconds).toBe(1);
    expect(s.welcome.channelId).toBe("");
  });
});
