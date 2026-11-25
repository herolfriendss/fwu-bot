import { describe, expect, it } from "vitest";
import {
  DISCORD_MAX_OPTIONS,
  DISCORD_MAX_ROOT_COMMANDS,
  groupSubcommands,
  SLASH_COMMANDS,
  SYSP_LAYOUT,
  toDiscordCommand,
  type SlashOption,
} from "@/lib/slash-commands";

type Node = { type: number; name: string; options?: Node[] };
const sub = (name: string): SlashOption => ({ type: 1, name, description: `Sous-commande ${name}` });
const sysp = () => SLASH_COMMANDS.find((command) => command.name === "sysp")!;

/** All leaf paths of a command, e.g. "outils clone" or "panel". */
function leafPaths(options: Node[] | undefined, prefix: string[] = []): string[] {
  return (options ?? []).flatMap((option) =>
    option.type === 2 ? leafPaths(option.options, [...prefix, option.name]) : [[...prefix, option.name].join(" ")]);
}

// Every subcommand that existed before this change, plus the new ones. None may disappear.
const EXISTING_SYSP_LEAVES = [
  "panel", "audit", "role", "admin-role", "whitelist-role", "intelligence-channel", "intelligence-toggle",
  "supervisor-set", "supervisor-remove", "supervisor-list", "ghost", "composer", "search", "incident",
  "blueprint", "add", "remove", "permissions", "permissions-edit", "whitelist-add", "whitelist-remove",
  "whitelist-list", "clone", "pack", "studio",
];
const DIAGNOSTIC_LEAVES = ["acl", "sante", "logs-couverture", "matrice", "economie", "bots", "installation"];
const URGENCE_LEAVES = ["gel", "degel", "alerte-abus"];
const SUIVI_LEAVES = ["fiche"];
const MARKET_LEAVES = ["catalog", "installed", "publish", "withdraw", "submit", "validate", "reject", "install", "uninstall", "rollback"];

describe("subcommand groups preserve every existing /sysp command", () => {
  it("keeps each pre-existing subcommand reachable by its name", () => {
    const leaves = leafPaths(sysp().options as Node[]).map((path) => path.split(" ").at(-1));
    for (const name of EXISTING_SYSP_LEAVES) {
      expect(leaves, `« ${name} » a disparu de /sysp`).toContain(name);
    }
  });

  it("places every subcommand exactly once and nothing is orphaned", () => {
    const leaves = leafPaths(sysp().options as Node[]);
    expect(new Set(leaves).size).toBe(leaves.length);
    expect(leaves.length).toBe(EXISTING_SYSP_LEAVES.length + MARKET_LEAVES.length + DIAGNOSTIC_LEAVES.length + URGENCE_LEAVES.length + SUIVI_LEAVES.length);
  });

  it("keeps the most used commands at the top level", () => {
    const top = (sysp().options as Node[]).filter((option) => option.type === 1).map((option) => option.name);
    expect(top).toEqual(expect.arrayContaining(["panel", "audit", "add", "remove", "permissions", "permissions-edit", "incident"]));
  });
});

describe("Discord limits", () => {
  it("keeps at most 25 entries at every level of /sysp and at most 25 per group", () => {
    const options = sysp().options as Node[];
    expect(options.length).toBeLessThanOrEqual(DISCORD_MAX_OPTIONS);
    for (const option of options.filter((item) => item.type === 2)) {
      expect(option.options?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(option.options?.length ?? 0).toBeLessThanOrEqual(DISCORD_MAX_OPTIONS);
    }
  });

  it("uses only Discord option types and at most three nesting levels (command > group > subcommand)", () => {
    // Only subcommands and groups nest; a subcommand's parameters (types 3-8) are not levels.
    const depth = (options: Node[] | undefined, level: number): number => (options ?? []).reduce((max, option) => {
      expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(option.type);
      if (option.type === 2) {
        for (const child of option.options ?? []) expect(child.type).toBe(1);
        return Math.max(max, depth(option.options, level + 1));
      }
      if (option.type === 1) return Math.max(max, level);
      return max;
    }, level);
    for (const command of SLASH_COMMANDS) {
      expect(depth(command.options as Node[] | undefined, 1)).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the number of top-level commands within Discord's global limit", () => {
    expect(SLASH_COMMANDS.length).toBeLessThanOrEqual(DISCORD_MAX_ROOT_COMMANDS);
    expect(new Set(SLASH_COMMANDS.map((command) => command.name)).size).toBe(SLASH_COMMANDS.length);
  });

  it("keeps group and subcommand names Discord-compatible", () => {
    for (const entry of SYSP_LAYOUT) {
      if (typeof entry === "string") continue;
      expect(entry.group).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(entry.description.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("registration payload", () => {
  it("emits subcommand groups as type 2 with nested type 1 subcommands", () => {
    const payload = toDiscordCommand(sysp());
    const market = (payload.options as Array<{ type: number; name: string; options?: Array<{ type: number; name: string }> }>)
      .find((option) => option.name === "market");
    expect(market?.type).toBe(2);
    expect(market?.options?.map((option) => option.name)).toEqual(MARKET_LEAVES);
    expect(market?.options?.every((option) => option.type === 1)).toBe(true);
  });

  it("keeps top-level leaves as type 1 and does not flatten groups", () => {
    const payload = toDiscordCommand(sysp());
    const topLevel = payload.options as Array<{ type: number; name: string }>;
    expect(topLevel.find((option) => option.name === "panel")?.type).toBe(1);
    expect(topLevel.find((option) => option.name === "config")?.type).toBe(2);
    expect(topLevel.find((option) => option.name === "whitelist-add")).toBeUndefined();
  });

  it("market install declares the consent flag as a boolean option", () => {
    const install = (sysp().options as Node[]).find((option) => option.name === "market")!.options!.find((option) => option.name === "install")!;
    expect(install.options?.find((option) => option.name === "confirmer")?.type).toBe(5);
  });
});

describe("groupSubcommands refuses inconsistent layouts", () => {
  const flat = [sub("a"), sub("b"), sub("c")];

  it("builds a valid layout", () => {
    const out = groupSubcommands(flat, ["a", { group: "g", description: "Groupe", members: ["b", "c"] }]);
    expect(out.map((option) => option.name)).toEqual(["a", "g"]);
    expect(out[1]!.type).toBe(2);
  });

  it("refuses a subcommand that is left out of the layout", () => {
    expect(() => groupSubcommands(flat, ["a", "b"])).toThrow(/non rangées : c/);
  });

  it("refuses a subcommand placed twice", () => {
    expect(() => groupSubcommands(flat, ["a", "a", "b", "c"])).toThrow(/rangée deux fois/);
  });

  it("refuses an unknown name and duplicate source names", () => {
    expect(() => groupSubcommands(flat, ["a", "b", "c", "zzz"])).toThrow(/inconnue/);
    expect(() => groupSubcommands([...flat, sub("a")], ["a", "b", "c"])).toThrow(/en double/);
  });

  it("refuses a group above 25 members and an empty group", () => {
    const many = Array.from({ length: 26 }, (_, i) => sub(`s${i}`));
    expect(() => groupSubcommands(many, [{ group: "g", description: "x", members: many.map((m) => m.name) }])).toThrow(/entre 1 et 25/);
    expect(() => groupSubcommands(flat, [{ group: "g", description: "x", members: [] }])).toThrow(/entre 1 et 25/);
  });

  it("refuses a first level above 25 entries", () => {
    const many = Array.from({ length: 26 }, (_, i) => sub(`t${i}`));
    expect(() => groupSubcommands(many, many.map((m) => m.name))).toThrow(/premier niveau/);
  });

  it("refuses options that are not subcommands", () => {
    expect(() => groupSubcommands([{ type: 3, name: "x", description: "option" }], ["x"])).toThrow(/seules les sous-commandes/);
  });
});
