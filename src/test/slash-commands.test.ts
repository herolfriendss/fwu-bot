import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, slashCommandsByCategory, toDiscordCommand } from "@/lib/slash-commands";

describe("V4 slash commands", () => {
  it("keeps every top-level command name unique and Discord-compatible", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of SLASH_COMMANDS) {
      expect(command.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("registers economy, DOG, voice, music and radio commands", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(names).toEqual(expect.arrayContaining([
      "balance", "daily", "pay", "shop", "roulette", "blackjack",
      "dog", "undog", "access", "panel", "play", "radio",
    ]));
  });

  it("marks commands that need the 24/7 gateway process", () => {
    const economy = SLASH_COMMANDS.find((command) => command.name === "balance");
    const core = SLASH_COMMANDS.find((command) => command.name === "aide");
    expect(economy?.requiresBotProcess).toBe(true);
    expect(core?.requiresBotProcess).toBeUndefined();
  });

  it("converts nested subcommands and restricts admin-only commands", () => {
    const shop = SLASH_COMMANDS.find((command) => command.name === "shop");
    const payload = toDiscordCommand(shop!);
    expect(payload["name"]).toBe("shop");
    expect(payload.options?.map((option) => option["name"])).toEqual(["voir", "ajouter", "retirer"]);

    const pnd = toDiscordCommand(SLASH_COMMANDS.find((command) => command.name === "pnd")!);
    expect(pnd.default_member_permissions).toBe("32");
    expect(pnd.dm_permission).toBe(false);

    const roulette = toDiscordCommand(SLASH_COMMANDS.find((command) => command.name === "roulette")!);
    expect(roulette.options?.find((option) => option["name"] === "choix")?.["choices"]).toHaveLength(3);
  });

  it("groups commands for /aide without losing any", () => {
    const grouped = slashCommandsByCategory().flatMap((group) => group.commands);
    expect(grouped).toHaveLength(SLASH_COMMANDS.length);
    expect(slashCommandsByCategory().map((group) => group.category)).toContain("Économie PND");
  });

  it("fits /aide into Discord embeds", () => {
    const groups = slashCommandsByCategory();
    const descriptions = groups.map((group) => group.commands.map((c) => `**/${c.name}** — ${c.description}`).join("\n"));
    expect(groups.length).toBeLessThanOrEqual(10);
    for (const description of descriptions) expect(description.length).toBeLessThanOrEqual(4096);
    expect(descriptions.reduce((total, description) => total + description.length, 0)).toBeLessThanOrEqual(6000);
  });
});
