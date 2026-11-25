import { describe, expect, it } from "vitest";
import { HANDCRAFTED_MODULES, MODULE_CATALOG, MODULE_OWNERS } from "@/lib/module-catalog";
import { DASHBOARD_SECTION_KEYS, DEFAULT_SETTINGS, SECTION_LABELS } from "@/lib/bot-settings";
import { SETUP_MODULES } from "../../bot/systems/setup/policy.js";

describe("dashboard module catalog", () => {
  it("lists every /setup module with its own name and description", () => {
    expect(MODULE_CATALOG.map((m) => m.key)).toEqual(Object.keys(SETUP_MODULES));
    for (const m of MODULE_CATALOG) {
      expect(m.label).toBe(SETUP_MODULES[m.key]!.label);
      expect(m.description).toBe(SETUP_MODULES[m.key]!.description);
    }
  });

  // Recipe for the bot team: a new /setup module needs an owner bot, a sanitized BotSettings key
  // and a dashboard section key. This test lists what is missing.
  it("can save every /setup module from the dashboard", () => {
    for (const key of Object.keys(SETUP_MODULES)) {
      expect(MODULE_OWNERS[key], `MODULE_OWNERS.${key}`).toBeDefined();
      expect((DASHBOARD_SECTION_KEYS as readonly string[]).includes(key), `DASHBOARD_SECTION_KEYS: ${key}`).toBe(true);
      expect(SECTION_LABELS[key as keyof typeof SECTION_LABELS], `SECTION_LABELS.${key}`).toBeDefined();
      if (key !== "dog") expect(DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS], `DEFAULT_SETTINGS.${key}`).toBeDefined();
    }
    expect(HANDCRAFTED_MODULES.every((key) => key in SETUP_MODULES)).toBe(true);
  });
});
