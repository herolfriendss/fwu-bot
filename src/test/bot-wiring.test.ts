import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXTRA_SLASH_COMMANDS, SLASH_COMMANDS, slashCommandsByCategory } from "@/lib/slash-commands";

const root = fileURLToPath(String(import.meta.url)).replace(/\/src\/test\/[^/]+$/, "/");
const read = (path: string) => readFileSync(root + path, "utf8");

const indexSrc = read("bot/index.js");
const v4Src = read("bot/v4-commands.js");
const moderationSrc = read("bot/moderation.js");
const gamesSrc = read("bot/games.js");

function quotedSet(source: string, name: string): Set<string> {
  const match = new RegExp(`${name} = new Set\\(\\[([^\\]]+)\\]\\)`).exec(source);
  if (!match) throw new Error(`Set ${name} introuvable`);
  return new Set([...match[1]!.matchAll(/"([a-z0-9-]+)"/g)].map((entry) => entry[1]!));
}

function commandNameChecks(source: string): Set<string> {
  const names = new Set(
    [...source.matchAll(/interaction\.commandName (?:!==|===) "([a-z0-9-]+)"/g)]
      .map((entry) => entry[1]!),
  );

  // Modules that declare their commands as `X_COMMANDS = new Set([...])` (GUARD, features, casino).
  // ECONOMY_V4_COMMANDS (index.js) only labels audit logs: it routes nothing.
  for (const match of source.matchAll(/\b([A-Z_]*COMMANDS)\s*=\s*new Set\(\[([^\]]+)\]\)/g)) {
    if (match[1] === "ECONOMY_V4_COMMANDS") continue;
    for (const entry of match[2]!.matchAll(/"([a-z0-9-]+)"/g)) names.add(entry[1]!);
  }

  const includesPattern =
    /\[([^\]]+)\]\s*\.includes\s*\(\s*interaction\.commandName\s*\)/g;

  for (const match of source.matchAll(includesPattern)) {
    for (const entry of match[1]!.matchAll(/"([a-z0-9-]+)"/g)) {
      names.add(entry[1]!);
    }
  }

  return names;
}

describe("bot wiring", () => {
  it("imports every V4 module from the gateway entry point", () => {
    for (const module of [
      "v4-commands", "social", "cards", "guild-guard", "guild-guard-commands",
      "moderation", "voice-v2", "games", "tickets", "automation",
    ]) {
      expect(indexSrc, module).toContain(`from "./${module}.js"`);
    }
    expect(indexSrc).toContain("from \"./economy.js\"");
    expect(indexSrc).toContain("from \"./music/music.js\"");
    expect(indexSrc).toContain("from \"./dog-commands.js\"");
    expect(indexSrc).toContain("from \"./systems/sysplus/whitelist-commands.js\"");
    expect(indexSrc).toContain("from \"./systems/lockname/commands.js\"");
    expect(indexSrc).toContain("from \"./systems/waouf/commands.js\"");
  });

  it("starts the scheduled loops and registers real handlers", () => {
    expect(indexSrc).toContain("startGamesScheduler(client, record, () => serves(\"fwu\"))");
    expect(indexSrc).toContain("startAutomationScheduler(client, record, () => serves(\"suckme\"))");
    expect(indexSrc).toContain("recoverBlackjackGames()");
    expect(indexSrc).toContain("handleAutomationJoin(member, s, record)");
    expect(indexSrc).toContain("handleGamesMessage(msg, record)");
    expect(indexSrc).toContain("handleTicketsInteraction(interaction");
    expect(indexSrc).toContain("handleAutomationInteraction(interaction");
  });

  it("registers commands by merging, never by a bulk PUT", () => {
    // FWU multi-bot: each application registers its own plan, one command at a time.
    expect(indexSrc).toContain("slashRegistrationPlan(RUNTIME, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS)");
    expect(indexSrc).toContain("for (const command of plan.register)");
    expect(indexSrc).toContain("await rest.delete(`${commandRoute}/${moved.id}`)");
    expect(indexSrc).toContain("rest.patch(`${commandRoute}/${current.id}`");
    expect(indexSrc).toContain("rest.post(commandRoute");
    expect(indexSrc).not.toMatch(/rest\.put\(/);
  });

  it("enforces the guild allowlist at startup, on resume and per event", () => {
    expect(indexSrc).toContain("enforceGuildAllowlist(client, ALLOWED_GUILDS, record)");
    expect(indexSrc.match(/enforceGuildAllowlist\(client, ALLOWED_GUILDS/g)).toHaveLength(2);
    expect(indexSrc).toContain("guildAllowed(msg.guild.id, ALLOWED_GUILDS)");
    expect(indexSrc).toContain("guildAllowed(member.guild.id, ALLOWED_GUILDS)");
    expect(indexSrc).toContain("guildAllowed(interaction.guildId, ALLOWED_GUILDS)");
    expect(indexSrc).toContain("guildAllowed(newMember.guild.id, ALLOWED_GUILDS)");
    expect(indexSrc).toContain("guildAllowed(channel.guild.id, ALLOWED_GUILDS)");
    expect(indexSrc).toContain("handleGuildCreate(guild, ALLOWED_GUILDS, record)");
    expect(indexSrc).toContain(".filter((guild) => guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id))");
  });

  it("routes every registered slash command to a concrete handler", () => {
    // /sysp is a deliberate shared dispatch: the WHITELIST module handles its
    // whitelist-* subcommands and returns false for everything else, which the SYS+
    // module then handles. Any other double route is still an error.
    // casino, blackjack, roulette : le casino v2 (bot/casino) répond avant l'ancien routeur V4, gardé en secours.
    const SHARED_DISPATCH = new Set(["sysp", "casino", "blackjack", "roulette"]);
    const handled = new Set<string>();
    // Group roots are routed by their subcommand dispatchers, not by a flat
    // interaction.commandName comparison; register them as concrete handlers.
    handled.add("voice");
    handled.add("music");
    const add = (name: string) => {
      if (handled.has(name) && !SHARED_DISPATCH.has(name)) throw new Error(`Commande ${name} routée deux fois`);
      handled.add(name);
    };

    for (const name of [...indexSrc.matchAll(/\bcommand === "([a-z0-9-]+)"/g)].map((m) => m[1]!)) add(name);
    for (const name of quotedSet(moderationSrc, "MODERATION_COMMANDS")) add(name);
    for (const name of quotedSet(gamesSrc, "GAME_COMMANDS")) add(name);
    for (const name of [...v4Src.matchAll(/case "([a-z0-9-]+)"/g)].map((m) => m[1]!)) add(name);
    for (const source of [
      indexSrc,
      read("bot/guild-guard-commands.js"),
      read("bot/staff-moderation.js"),
      read("bot/guard/commands.js"),
      read("bot/guard/shield-commands.js"),
      read("bot/features/community.js"),
      read("bot/features/suckme.js"),
      read("bot/features/perks-commands.js"),
      read("bot/features/clans-commands.js"),
      read("bot/features/confessions-commands.js"),
      read("bot/features/tools-commands.js"),
      read("bot/features/animation-commands.js"),
      read("bot/features/fisc.js"),
      read("bot/features/investplus-commands.js"),
      read("bot/features/versus.js"),
      read("bot/features/overview.js"),
      read("bot/features/self-update.js"),
      read("bot/features/quests-commands.js"),
      read("bot/music/music.js"),
      read("bot/casino/commands.js"),
      read("bot/embeds.js"),
      read("bot/resume.js"),
      read("bot/blacklist.js"),
      read("bot/live-commands.js"),
      read("bot/dmall.js"),
      read("bot/dog-commands.js"),
      read("bot/systems/sysplus/commands.js"),
      read("bot/tickets.js"),
      read("bot/automation.js"),
      read("bot/voice-v2.js"),
      read("bot/voice-commands.js"),
      read("bot/pnd-knowledge.js"),
      read("bot/role-commands.js"),
      read("bot/webhooks.js"),
      read("bot/systems/sysplus/whitelist-commands.js"),
      read("bot/systems/lockname/commands.js"),
      read("bot/systems/waouf/commands.js"),
      read("bot/systems/setup/panel-setup.js"),
      read("bot/systems/entitlements/commands.js"),
      read("bot/systems/marketplace/commands.js"),
      read("bot/systems/creator/commands.js"),
      read("bot/logs-commands.js"),
      read("bot/blr-commands.js"),
      read("bot/guard/raid-commands.js"),
      read("bot/permission-guide.js"),
      read("bot/voice-mass.js"),
      read("bot/voice-move.js"),
      read("bot/presence.js"),
      read("bot/stability.js"),
      read("bot/features/smash.js"),
      read("bot/features/family.js"),
      read("bot/features/heist.js"),
      read("bot/features/blindtest.js"),
      read("bot/guard/alt-detect.js"),
    ]) {
      for (const name of commandNameChecks(source)) add(name);
    }

    // Catalogue complet : les 100 historiques + les commandes supplémentaires (FWU, SUCK ME…).
    const registered = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS].map((command) => command.name);
    expect(registered.filter((name) => !handled.has(name))).toEqual([]);
    // Legacy top-level names kept as compatibility aliases after /pnd and /sysp
    // grouping (Discord command limit). They are handled but intentionally not
    // registered, and existing tests call them directly. Any other unregistered
    // handler is still an error.
    const LEGACY_ALIASES = new Set([
      "pnd-add", "pnd-remove", "pnd-history", "pnd-audit",
      "sys-panel", "sys-add", "sys-remove", "action-history", "permissions", "permissions-edit",
      // vocal-panel: folded into /voc. salut and info-serveur: handlers still present in
      // bot/index.js but not in the catalog (the 100 root-command limit is reached), so they
      // cannot be invoked via slash. Kept for now; removal/folding is an owner decision.
      "vocal-panel", "salut", "info-serveur",
      // Retired top-level commands remain in internal dispatch code for stale
      // registrations/compatibility, but are no longer published by the catalogue.
      "access", "unaccess",
      "play", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume", "loop",
      "shuffle", "clearqueue", "remove", "join", "leave", "musicpanel",
    ]);
    expect([...handled].filter((name) => !registered.includes(name) && !LEGACY_ALIASES.has(name))).toEqual([]);
  });

  it("keeps the /aide embed list within Discord's ten-embed limit", () => {
    const categories = slashCommandsByCategory();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.length).toBeLessThanOrEqual(10);
  });
});
