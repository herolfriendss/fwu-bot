import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, slashCommandsByCategory, toDiscordCommand } from "@/lib/slash-commands";

// Leaf subcommand names of a command, looking inside Discord subcommand groups too.
function leafNames(options: SlashOptionLike[] | undefined): string[] {
  return (options ?? []).flatMap((option) => (option.type === 2 ? leafNames(option.options) : [option.name]));
}
type PayloadOption = { name: string; type?: number; options?: PayloadOption[] };
type CommandPayload = { options?: PayloadOption[]; default_member_permissions?: string; dm_permission?: boolean };
type SlashOptionLike = { type: number; name: string; options?: SlashOptionLike[] };

describe("V4 slash commands", () => {
  it("keeps low-priority greeting and server-info shortcuts out of the root catalogue", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(names).not.toContain("salut");
    expect(names).not.toContain("info-serveur");
    expect(names).toContain("music");
    expect(names).not.toContain("musicpanel");
    expect(names).toContain("sysp");
  });

  it("keeps every top-level command name unique and Discord-compatible", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeLessThanOrEqual(100);
    for (const command of SLASH_COMMANDS) {
      expect(command.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("keeps every command and nested option within Discord catalogue limits", () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.options?.length ?? 0).toBeLessThanOrEqual(25);
      for (const option of command.options ?? []) {
        expect(option.name.length).toBeLessThanOrEqual(32);
        expect(option.description.length).toBeLessThanOrEqual(100);
        expect(option.options?.length ?? 0).toBeLessThanOrEqual(25);
      }
    }
  });

  it("registers economy, DOG, voice, music and radio commands", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(names).toEqual(expect.arrayContaining([
      "balance", "daily", "pay", "shop", "roulette", "blackjack",
      "dog", "undog", "menotte", "unmenotte", "menotteinfo", "access", "panel", "music", "radio", "pnd", "lockname", "wouaf",
    ]));
    for (const name of ["dog", "undog", "doginfo"]) {
      expect(SLASH_COMMANDS.find((command) => command.name === name)?.defaultMemberPermissions).toBeUndefined();
    }
  });

  it("consolidates all player actions under /music without dropping a subcommand", () => {
    const music = SLASH_COMMANDS.find((command) => command.name === "music");
    expect(music?.requiresBotProcess).toBe(true);
    expect(music?.options).toHaveLength(1);
    expect(music?.options?.[0]).toMatchObject({ type: 2, name: "player" });
    expect(leafNames(music?.options as SlashOptionLike[] | undefined)).toEqual([
      "play", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume",
      "loop", "shuffle", "clearqueue", "remove", "join", "leave", "panel",
    ]);
    const names = SLASH_COMMANDS.map((command) => command.name);
    for (const retired of [
      "play", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume", "loop",
      "shuffle", "clearqueue", "remove", "join", "leave", "musicpanel",
    ]) expect(names).not.toContain(retired);
  });

  it("uses /wouaf as the public WOUAF command name", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(names).toContain("wouaf");
    expect(names).not.toContain("waouf");
  });

  it("registers WHITELIST commands and limits them to the live bot process", () => {
    const sysp = SLASH_COMMANDS.find((command) => command.name === "sysp");
    const names = leafNames(sysp?.options as SlashOptionLike[] | undefined);
    expect(names).toEqual(expect.arrayContaining(["whitelist-add", "whitelist-remove", "whitelist-list", "whitelist-role"]));
    expect(sysp?.requiresBotProcess && sysp.dmPermission === false).toBe(true);
  });

  it("registers LOCKNAME protection actions on the bot process", () => {
    const command = SLASH_COMMANDS.find((item) => item.name === "lockname");
    expect(command?.options?.map((option) => option.name)).toEqual(["proteger", "retirer", "liste"]);
    expect(command?.requiresBotProcess).toBe(true);
  });

  it("exposes MENOTTE duration bounds and bot-backed release/status commands", () => {
    const menotte = SLASH_COMMANDS.find((command) => command.name === "menotte");
    const duration = menotte?.options?.find((option) => option.name === "duree_minutes");
    expect(duration).toMatchObject({ min_value: 1, max_value: 43_200 });
    for (const name of ["menotte", "unmenotte", "menotteinfo"]) {
      expect(SLASH_COMMANDS.find((command) => command.name === name)?.requiresBotProcess).toBe(true);
    }
  });

  it("exposes the themed Webhook animation switch to runtime-authorized staff", () => {
    const webhook = SLASH_COMMANDS.find((command) => command.name === "webhook");
    expect(webhook).toBeDefined();
    expect(webhook?.defaultMemberPermissions).toBeUndefined();
    expect(webhook?.options?.map((option) => option.name)).toContain("animation");
    const animation = webhook?.options?.find((option) => option.name === "animation");
    expect(animation?.options?.map((option) => option.name)).toEqual(["etat", "id"]);
    expect(animation?.options?.find((option) => option.name === "etat")?.choices).toEqual([
      { name: "Activer", value: "on" },
      { name: "Désactiver", value: "off" },
    ]);
  });

  it("marks commands that need the 24/7 gateway process", () => {
    const economy = SLASH_COMMANDS.find((command) => command.name === "balance");
    const core = SLASH_COMMANDS.find((command) => command.name === "aide");
    expect(economy?.requiresBotProcess).toBe(true);
    expect(core?.requiresBotProcess).toBeUndefined();
  });

  it("exposes the Discord First panel and setup while retaining the vocal panel under /voc", () => {
    const commands = new Map(SLASH_COMMANDS.map((command) => [command.name, command]));
    expect(commands.get("panel")?.description).toContain("centre de contrôle");
    expect(commands.get("setup")?.requiresBotProcess).toBe(true);
    // /vocal-panel was folded into /voc to stay under Discord's 100 root commands.
    expect(commands.has("vocal-panel")).toBe(false);
    const voc = commands.get("voc");
    expect(voc?.options?.some((option) => option.name === "vocal-panel")).toBe(true);
  });

  it("registers ADMIN+ permission controls with a finite module choice list", () => {
    const sysp = SLASH_COMMANDS.find((command) => command.name === "sysp");
    const permissions = sysp?.options?.find((option) => option.name === "permissions");
    const edit = sysp?.options?.find((option) => option.name === "permissions-edit");
    const moduleChoices = edit?.options?.find((option) => option.name === "module")?.choices;
    expect(permissions).toBeDefined();
    expect(moduleChoices?.map((choice) => choice.value)).toEqual(["roles", "voice", "lockname", "tickets"]);
  });

  it("registers the profession subcommands and fixed profession choices", () => {
    const job = SLASH_COMMANDS.find((command) => command.name === "job");
    expect(job?.options?.map((option) => option.name)).toEqual(["list", "status", "choose", "mission", "contract"]);
    expect(job?.options?.[2]?.options?.[0]?.choices?.map((choice) => choice.value)).toEqual([
      "artisan", "explorer", "host", "mechanic", "courier",
    ]);
    expect(job?.options?.[3]).toMatchObject({
      type: 2,
      options: [{ name: "status" }, { name: "claim" }],
    });
    const payload = toDiscordCommand(job!);
    expect(payload.options?.[3]).toMatchObject({
      type: 2,
      name: "mission",
      options: [{ type: 1, name: "status" }, { type: 1, name: "claim" }],
    });
    expect((payload as unknown as CommandPayload).options?.[4]?.name).toBe("contract");
    expect((payload as unknown as CommandPayload).options?.[4]?.options?.map((option) => option.name)).toEqual([
      "create", "list", "claim", "submit", "approve", "cancel",
    ]);
  });

  it("keeps staff supervisor management under the existing /sysp root command", () => {
    const sysp = SLASH_COMMANDS.find((command) => command.name === "sysp");
    const names = leafNames(sysp?.options as SlashOptionLike[] | undefined);
    expect(names).toContain("supervisor-set");
    expect(names).toContain("supervisor-remove");
    expect(names).toContain("supervisor-list");
    expect(names).toContain("blueprint");
    expect(names).toContain("incident");
    expect(SLASH_COMMANDS.length).toBeLessThanOrEqual(100);
  });

  it("keeps the PND market under shop so the global catalogue cap stays stable", () => {
    const shop = SLASH_COMMANDS.find((command) => command.name === "shop");
    const market = shop?.options?.find((option) => option.name === "market");
    const auction = shop?.options?.find((option) => option.name === "auction");
    expect(market?.type).toBe(2);
    expect(market?.options?.map((option) => option.name)).toEqual(["list", "sell", "buy", "cancel"]);
    expect(auction?.type).toBe(2);
    expect(auction?.options?.map((option) => option.name)).toEqual(["list", "create", "bid", "cancel"]);
    expect(SLASH_COMMANDS.length).toBeLessThanOrEqual(100);
  });

  it("converts nested subcommands and restricts admin-only commands", () => {
    const shop = SLASH_COMMANDS.find((command) => command.name === "shop");
    const payload = toDiscordCommand(shop!);
    expect(payload["name"]).toBe("shop");
    expect(payload.options?.map((option) => option["name"])).toEqual(["voir", "ajouter", "retirer", "market", "auction"]);

    const pnd = toDiscordCommand(SLASH_COMMANDS.find((command) => command.name === "pnd")!);
    expect((pnd as unknown as CommandPayload).default_member_permissions).toBeUndefined();
    expect((pnd as unknown as CommandPayload).dm_permission).toBe(false);
    expect((pnd as unknown as CommandPayload).options?.map((option) => option.name)).toEqual(expect.arrayContaining(["ajouter", "retirer", "definir", "historique", "audit"]));

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

  it("exposes Guardian human-review tools under the existing GuildGuard command", () => {
    const command = SLASH_COMMANDS.find((item) => item.name === "guildguard");
    expect(command?.options?.map((option) => option.name)).toContain("review");
    expect(command?.options?.map((option) => option.name)).toContain("resolve");
  });

  it("exposes PND V5 business, investment, casino and community services in slash", () => {
    const byName = new Map(SLASH_COMMANDS.map((command) => [command.name, command]));
    for (const name of ["business", "invest", "casino", "pndevent", "academy", "award", "story", "radar", "wrapped", "candidature", "vocalpresence", "staffhistory"]) {
      expect(byName.get(name)?.requiresBotProcess).toBe(true);
      expect(byName.get(name)?.dmPermission).toBe(false);
    }
    expect(byName.get("business")?.options?.map((option) => option.name)).toEqual(expect.arrayContaining(["create", "hire", "salary", "withdraw", "payroll"]));
    expect(byName.get("business")?.options?.find((option) => option.name === "create")?.options?.find((option) => option.name === "nom")?.max_length).toBe(40);
    expect(byName.get("invest")?.options?.map((option) => option.name)).toContain("policy");
    expect(byName.get("invest")?.options?.find((option) => option.name === "create")?.options?.find((option) => option.name === "risque")?.max_value).toBe(1000);
    expect(byName.get("invest")?.options?.find((option) => option.name === "policy")?.options?.every((option) => option.max_value === 1000)).toBe(true);
    expect(byName.get("casino")?.options?.map((option) => option.name)).toEqual(expect.arrayContaining(["roulette", "slots", "coinflip", "dice", "historique", "stats", "limites", "limite", "limite-off", "pause"]));
    expect(byName.get("casino")?.options?.find((option) => option.name === "pause")?.options?.[0]?.choices?.map((choice) => choice.value)).toEqual(["24h", "7j", "30j", "permanent"]);
    expect(byName.get("pndevent")?.options?.map((option) => option.name)).toEqual(["liste", "creer", "join", "leave", "cancel"]);
    expect(byName.get("academy")?.options?.map((option) => option.name)).toEqual(["liste", "creer", "show", "complete", "progress", "quiz"]);
    expect(byName.get("academy")?.options?.find((option) => option.name === "show")?.options?.[1]?.required).toBeUndefined();
    expect(byName.get("academy")?.options?.find((option) => option.name === "quiz")?.options?.[2]?.max_length).toBe(900);
    expect(byName.get("award")?.options?.map((option) => option.name)).toEqual(["liste", "creer", "vote", "close"]);
    expect(byName.get("story")?.options?.map((option) => option.name)).toEqual(["liste", "creer", "approve", "publish"]);
    expect(byName.has("candidatures")).toBe(false);
    expect(byName.get("candidature")?.options?.map((option) => option.name)).toEqual(["deposer", "liste", "questions", "voir", "review", "assign", "entretien", "entretiens", "evaluation", "annuler-entretien"]);
    expect(byName.get("candidature")?.options?.find((option) => option.name === "deposer")?.options?.[0]).toMatchObject({ name: "reponses", required: true, max_length: 1000 });
    expect(SLASH_COMMANDS.some((command) => command.name === "addrole")).toBe(false);
    expect(SLASH_COMMANDS.length).toBeLessThanOrEqual(100);
  });
});


describe("PND Voice Access slash entry", () => {
  it("exposes channel-picker and hidden-channel-ID request paths under /voc", () => {
    const command = SLASH_COMMANDS.find((item) => item.name === "voc");
    const requestById = command?.options?.find((option) => option.name === "demander-id");
    expect(command?.options?.some((option) => option.name === "demander")).toBe(true);
    expect(requestById?.options?.[0]).toMatchObject({
      type: 3,
      name: "id",
      required: true,
      min_length: 5,
      max_length: 25,
    });
    expect(command?.options?.some((option) => option.name === "debloquer")).toBe(true);
    expect(SLASH_COMMANDS.length).toBeLessThanOrEqual(100);
  });
});

describe("PND command additions", () => {
  it("exposes individual and mass role assignment without bypassing existing role controls", () => {
    const rank = SLASH_COMMANDS.find((item) => item.name === "rank");
    const rankAll = SLASH_COMMANDS.find((item) => item.name === "rankall");
    expect(rank?.options?.map((option) => option.name)).toEqual(["membre", "role"]);
    expect(rank?.requiresBotProcess).toBe(true);
    expect(rankAll?.options?.map((option) => option.name)).toEqual(["role"]);
  });

  it("exposes WAKEUP without a destination: the bot walks the member through public voice channels", () => {
    const wakeup = SLASH_COMMANDS.find((item) => item.name === "wakeup");
    expect(wakeup?.options?.map((option) => option.name)).toEqual(["membre", "message"]);
    expect(wakeup?.options?.some((option) => option.channel_types)).toBe(false);
    expect(wakeup?.requiresBotProcess).toBe(true);
  });
});
