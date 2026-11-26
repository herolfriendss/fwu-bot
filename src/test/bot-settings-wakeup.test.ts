import { describe, expect, it } from "vitest";
import {
  BOT_MODULE_SETTINGS_KEYS,
  mergeSettingsForWrite,
  sanitizeSettings,
  sanitizeWakeupSettings,
} from "@/lib/bot-settings";
import { SLASH_COMMANDS } from "@/lib/slash-commands";

describe("WAKEUP exclusion settings", () => {
  it("is accepted as a module setting", () => {
    expect(BOT_MODULE_SETTINGS_KEYS).toContain("wakeup");
  });

  it("stays absent unless the input carries it", () => {
    expect(sanitizeSettings({}).wakeup).toBeUndefined();
  });

  it("keeps valid ids only, deduplicated and capped", () => {
    const many = Array.from({ length: 30 }, (_, i) => String(100000 + i));
    const result = sanitizeWakeupSettings({
      ownerChannelId: " 123456 ",
      waitingChannelId: "nope",
      excludedChannelIds: [...many, "100000", 7, null, "abc"],
    });
    expect(result.ownerChannelId).toBe("123456");
    expect(result.waitingChannelId).toBeNull();
    expect(result.excludedChannelIds).toHaveLength(20);
    expect(new Set(result.excludedChannelIds).size).toBe(20);
  });

  it("a save that does not mention wakeup never rewrites the stored value", () => {
    const latest = sanitizeSettings({ wakeup: { ownerChannelId: "123456" } });
    const incoming = sanitizeSettings({});
    expect(
      mergeSettingsForWrite(incoming, latest, true).wakeup?.ownerChannelId,
    ).toBe("123456");
  });
});

describe("/wakeup command definition", () => {
  it("only asks for the member and an optional message, never a destination channel", () => {
    const command = SLASH_COMMANDS.find((item) => item.name === "wakeup")!;
    // V2 : option « test » (simulation du parcours), toujours aucun salon de destination.
    expect(command.options?.map((option) => option.name)).toEqual([
      "membre",
      "message",
      "test",
    ]);
    expect(command.options?.some((option) => option.type === 7)).toBe(false);
    expect(
      command.options
        ?.filter((option) => option.required)
        .map((option) => option.name),
    ).toEqual(["membre"]);
    expect(command.usage).not.toMatch(/salon/);
  });
});
