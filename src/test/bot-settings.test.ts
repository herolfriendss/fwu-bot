import { describe, expect, it } from "vitest";
import { BOT_MODULE_SETTINGS_KEYS, containsBannedWord, matchKeyword, sanitizeSettings } from "@/lib/bot-settings";

describe("bot settings", () => {
  it("keeps SYS+ and WHITELIST roles isolated and guild-local", () => {
    expect(sanitizeSettings({ sysPlus: { roleId: "11111", whitelistRoleId: "22222" } }).sysPlus)
      .toMatchObject({ roleId: "11111", whitelistRoleId: "22222", intelligenceEnabled: false, intelligenceChannelId: null });
    expect(sanitizeSettings({ sysPlus: { roleId: "bad", whitelistRoleId: "22222" } }).sysPlus)
      .toMatchObject({ roleId: null, whitelistRoleId: "22222", intelligenceEnabled: false, intelligenceChannelId: null });
  });

  it("sanitizes PND Intelligence channel and enabled state", () => {
    expect(sanitizeSettings({ sysPlus: { intelligenceEnabled: true, intelligenceChannelId: "123456789012345678" } }).sysPlus)
      .toMatchObject({ intelligenceEnabled: true, intelligenceChannelId: "123456789012345678" });
    expect(sanitizeSettings({ sysPlus: { intelligenceEnabled: "true", intelligenceChannelId: "not-a-channel" } }).sysPlus)
      .toMatchObject({ intelligenceEnabled: false, intelligenceChannelId: null });
  });

  it("syncs separate role restrictions for =panel and =pv", () => {
    expect(sanitizeSettings({ voiceAccess: { panelRoleIds: ["11111"], pvRoleIds: ["22222"] } }).voiceAccess).toEqual({ panelRoleIds: ["11111"], pvRoleIds: ["22222"], requestChannelId: null });
    expect(sanitizeSettings({}).voiceAccess).toEqual({ panelRoleIds: null, pvRoleIds: null, requestChannelId: null });
    expect(sanitizeSettings({ voiceAccess: { panelRoleIds: [], pvRoleIds: [] } }).voiceAccess).toEqual({ panelRoleIds: [], pvRoleIds: [], requestChannelId: null });
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
    const s = sanitizeSettings({ spam: { maxMessages: 999, perSeconds: 0, timeoutMinutes: 5, maxMentions: 99 }, welcome: { channelId: "abc" } });
    expect(s.spam.maxMessages).toBe(30);
    expect(s.spam.perSeconds).toBe(1);
    expect(s.spam.maxMentions).toBe(20);
    expect(s.welcome.channelId).toBe("");
    expect(s.welcome.leaveEnabled).toBe(false);
    expect(s.welcome.leaveChannelId).toBe("");
    expect(s.welcome.leaveMessage).toBe("{user} a quitté **{server}**.");
  });

  it("sanitizes configurable departure messages and accepts only Discord channel ids", () => {
    const s = sanitizeSettings({ welcome: { leaveEnabled: true, leaveChannelId: "123456789012345", leaveMessage: "Au revoir {user}" } });
    expect(s.welcome).toMatchObject({ leaveEnabled: true, leaveChannelId: "123456789012345", leaveMessage: "Au revoir {user}" });
    expect(sanitizeSettings({ welcome: { leaveEnabled: true, leaveChannelId: "not-a-channel" } }).welcome.leaveChannelId).toBe("");
  });

  it("keeps AI conversation memory opt-in and sanitizes the setting", () => {
    expect(sanitizeSettings({}).ai.memoryEnabled).toBe(false);
    expect(sanitizeSettings({ ai: { enabled: true, memoryEnabled: true } }).ai).toMatchObject({ enabled: true, memoryEnabled: true });
    expect(sanitizeSettings({ ai: { memoryEnabled: "yes" } }).ai.memoryEnabled).toBe(false);
  });

  it("sanitizes live alert creators and requires HTTPS feeds", () => {
    const s = sanitizeSettings({ liveAlerts: { enabled: true, channelId: "123456", creators: [
      { id: "yt-1", platform: "youtube", displayName: "Creator", feedUrl: "https://example.com/feed.xml" },
      { id: "bad", platform: "tiktok", displayName: "Unsafe", feedUrl: "http://example.com/feed.xml" },
    ] } });
    expect(s.liveAlerts.enabled).toBe(true);
    expect(s.liveAlerts.channelId).toBe("123456");
    expect(s.liveAlerts.creators).toHaveLength(1);
    expect(s.liveAlerts.creators[0]?.platform).toBe("youtube");
    expect(s.liveAlerts.animated).toBe(true);
    expect(sanitizeSettings({ liveAlerts: { animated: false } }).liveAlerts.animated).toBe(false);
  });

  it("provides V4 module defaults for a legacy configuration", () => {
    const s = sanitizeSettings({ keywords: [{ trigger: "salut", response: "hey" }] });
    expect(s.guildGuard).toMatchObject({ enabled: false, minAccountAgeDays: 7, raidWindowSeconds: 60, quarantineRoleId: null });
    expect(s.moderation).toMatchObject({ dmOnWarn: true, warnExpiryDays: 90, logChannelId: null });
    expect(s.verification).toMatchObject({ enabled: false, roleId: null, channelId: null, minAccountAgeDays: 7 });
    expect(s.tickets).toMatchObject({ enabled: false, maxOpenPerUser: 1 });
    expect(s.tempVoice).toMatchObject({ enabled: false, defaultLimit: 0, nameTemplate: "Salon de {user}", emptyDeleteSeconds: 0 });
    expect(s.automation).toMatchObject({ autoRoleIds: [], welcomeDm: false });
  });

  it("bounds every V4 module independently", () => {
    const s = sanitizeSettings({
      guildGuard: { enabled: true, minAccountAgeDays: -4, raidJoinThreshold: 9_999, raidWindowSeconds: 1, youngAccountAction: "nuke", quarantineRoleId: "abc" },
      moderation: { warnExpiryDays: 9_999, dmOnWarn: "yes", logChannelId: "123" },
      verification: { minAccountAgeDays: 9_999, roleId: "not-an-id" },
      tickets: { maxOpenPerUser: 99 },
      tempVoice: { defaultLimit: 500, nameTemplate: "x".repeat(200), hubChannelId: "abc", emptyDeleteSeconds: 9000 },
      automation: { autoRoleIds: ["111111111111111111", "111111111111111111", "bad"], welcomeDm: true },
    });
    expect(s.guildGuard).toMatchObject({ enabled: true, minAccountAgeDays: 0, raidJoinThreshold: 100, raidWindowSeconds: 10, youngAccountAction: "log", quarantineRoleId: null });
    expect(s.moderation).toMatchObject({ warnExpiryDays: 365, dmOnWarn: true, logChannelId: null });
    expect(s.verification).toMatchObject({ minAccountAgeDays: 365, roleId: null });
    expect(s.tickets.maxOpenPerUser).toBe(5);
    expect(s.tempVoice.defaultLimit).toBe(99);
    expect(s.tempVoice.nameTemplate).toHaveLength(80);
    expect(s.tempVoice.hubChannelId).toBeNull();
    expect(s.tempVoice.emptyDeleteSeconds).toBe(300);
    expect(s.automation).toMatchObject({ welcomeDm: true });
    expect(s.automation.autoRoleIds).toEqual(["111111111111111111"]);
  });

  it("merges a single module update without touching the other modules", () => {
    // Mirrors the bot-sync `module-settings` action: dashboard settings are the
    // source of truth, the bot change is merged into them, then sanitized.
    const current = sanitizeSettings({
      keywords: [{ trigger: "salut", response: "hey" }],
      guildGuard: { enabled: true, minAccountAgeDays: 30 },
      tickets: { enabled: true, maxOpenPerUser: 3 },
      voiceAccess: { panelRoleIds: ["11111"], pvRoleIds: ["22222"] },
    });
    const merged = sanitizeSettings({ ...current, tickets: { enabled: false } });
    expect(merged.tickets.enabled).toBe(false);
    expect(merged.tickets.maxOpenPerUser).toBe(1);
    expect(merged.guildGuard).toEqual(current.guildGuard);
    expect(merged.voiceAccess).toEqual(current.voiceAccess);
    expect(merged.keywords).toEqual(current.keywords);
    expect(merged.automation).toEqual(current.automation);
    expect(BOT_MODULE_SETTINGS_KEYS).toContain("spam");
  });
});

describe("LIVE mention role", () => {
  it("keeps a valid role id and drops anything else", async () => {
    const { sanitizeSettings } = await import("@/lib/bot-settings");
    expect(sanitizeSettings({ liveAlerts: { mentionRoleId: "123456789" } }).liveAlerts.mentionRoleId).toBe("123456789");
    expect(sanitizeSettings({ liveAlerts: { mentionRoleId: "@everyone" } }).liveAlerts.mentionRoleId).toBeNull();
    expect(sanitizeSettings({}).liveAlerts.mentionRoleId).toBeNull();
  });
});
