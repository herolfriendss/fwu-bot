// Modules shown on the dashboard. Names, descriptions, switches and fields come straight from
// the Discord /setup definition (bot/systems/setup/policy.js, plain data shared with the bot),
// so a module added there appears on the site without any dashboard change.
// `MODULE_OWNERS` says which bot runs each module (see the serves("…") gates in bot/index.js).
import { SETUP_MODULES, type SetupField } from "../../bot/systems/setup/policy.js";
import type { BotProfileId } from "./bot-profiles";

export const MODULE_OWNERS: Record<string, BotProfileId> = {
  spam: "guard",
  guildGuard: "guard",
  verification: "guard",
  moderation: "fwu",
  tickets: "fwu",
  liveAlerts: "fwu",
  tempVoice: "fdpdlavoc",
  automation: "suckme",
  dog: "suckme",
};

export type ModuleCatalogEntry = {
  key: string;
  label: string;
  description: string;
  owner: BotProfileId;
  /** false = no on/off switch, the module is always active. */
  toggle: boolean;
  fields: SetupField[];
};

export const MODULE_CATALOG: readonly ModuleCatalogEntry[] = Object.entries(SETUP_MODULES).map(([key, def]) => ({
  key,
  label: def.label,
  description: def.description,
  owner: MODULE_OWNERS[key] ?? "fwu",
  toggle: def.fields.some((f) => f.key === "enabled"),
  fields: def.fields,
}));

/** Modules that have a hand-made screen on the Modules tab; any other /setup module gets a generated form. */
export const HANDCRAFTED_MODULES: readonly string[] = ["spam", "guildGuard", "moderation", "verification", "tickets", "tempVoice", "automation", "dog", "liveAlerts"];
