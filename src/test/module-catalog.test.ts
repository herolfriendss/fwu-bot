import { describe, expect, it } from "vitest";
import { MODULE_CATALOG } from "@/lib/module-catalog";
import { BOT_PROFILES } from "@/lib/bot-profiles";
// @ts-expect-error plain JS module of the bot
import { SETUP_MODULES, setupHasToggle } from "../../bot/systems/setup/policy.js";

describe("dashboard module catalog", () => {
  it("matches the Discord /setup list, names, descriptions and switches", () => {
    expect(MODULE_CATALOG.map((m) => m.key)).toEqual(Object.keys(SETUP_MODULES));
    for (const m of MODULE_CATALOG) {
      expect(m.label, m.key).toBe(SETUP_MODULES[m.key].label);
      expect(m.description, m.key).toBe(SETUP_MODULES[m.key].description);
      expect(m.toggle, m.key).toBe(Boolean(setupHasToggle(m.key)));
      expect(BOT_PROFILES[m.owner]).toBeDefined();
    }
  });
});
