import { describe, expect, it } from "vitest";
import { BOT_MODULE_SETTINGS_KEYS } from "@/lib/bot-settings";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(String(import.meta.url)).replace(/\/src\/test\/[^/]+$/, "/");
const read = (path: string) => readFileSync(root + path, "utf8");

const panel = read("src/components/V4ModulesPanel.tsx");
const configuration = read("src/routes/configuration.tsx");
const functions = read("src/lib/bot-settings.functions.ts");
const botSync = read("src/routes/api/public/bot-sync.ts");

describe("V4 dashboard wiring", () => {
  it("renders the V4 modules panel from the configuration tab", () => {
    expect(configuration).toContain('import { V4ModulesPanel } from "@/components/V4ModulesPanel"');
    expect(configuration).toContain('{ id: "modules", label: "Modules V4"');
    expect(configuration).toContain('tab === "modules" && <V4ModulesPanel');
  });

  it("edits every V4 module and saves through the same settings object", () => {
    for (const module of ["guildGuard", "moderation", "verification", "tickets", "tempVoice", "automation"]) {
      expect(panel, module).toContain(`s.${module}.`);
      expect(panel, module).toContain(`"${module}"`);
    }
    expect(panel).toContain("save({ data: { guildId, settings: s } })");
    expect(panel).toContain('queryKey: ["bot-settings", guildId]');
  });

  it("previews the branded animated webhook art and explains its Discord switch", () => {
    const css = read("src/styles.css");
    expect(panel).toContain("/media/her-v5-city-loop.gif");
    expect(panel).toContain("/webhook animation etat:off");
    expect(css).toContain(".console-theme-panel");
    expect(css).toContain("her-v5-city-loop.gif");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps the settings server functions owner-gated", () => {
    const calls = functions.match(/requireOwner\(\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(functions).toContain("sanitizeSettings(d.settings)");
  });

  it("accepts only the configured bot modules in bot-sync", () => {
    // bot-sync validates module names against the shared constant, so the test
    // checks both the wiring and the exact allowed set.
    expect(botSync).toContain("new Set<string>(BOT_MODULE_SETTINGS_KEYS)");
    expect([...BOT_MODULE_SETTINGS_KEYS].sort()).toEqual(
      ["automation", "dog", "guildGuard", "liveAlerts", "moderation", "spam", "tempVoice", "tickets", "verification", "wakeup"],
    );
    expect(botSync).toContain("sanitizeSettings({ ...current, [module]: body.settings })");
  });
});
