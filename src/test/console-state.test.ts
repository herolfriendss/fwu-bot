import { describe, expect, it } from "vitest";
import { buildConsoleState, eventCategory, eventSeverity, type RuntimeRow } from "@/lib/console-state";
import { BOT_PROFILE_IDS, SLASH_COMMAND_OWNERS } from "@/lib/bot-profiles";
import { EVENT_LABELS, runtimeEventCodes } from "@/lib/bot-status";
import type { BotCommand } from "@/lib/bot-control";

const now = Date.parse("2026-11-27T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const row = (id: string, over: Partial<RuntimeRow> = {}): RuntimeRow => ({
  id, connected: true, last_seen: iso(now - 5_000), last_sync: iso(now - 20_000), started_at: iso(now - 3_600_000),
  events: [], guilds: [{ id: "123456789012345678", name: "Serveur", icon: null }], ...over,
});

describe("état de la console", () => {
  it("montre les six bots même sans aucun rapport, sans inventer d'état", () => {
    const state = buildConsoleState({ rows: [], activity: [], commands: [], now });
    expect(state.bots.map((b) => b.id)).toEqual([...BOT_PROFILE_IDS]);
    expect(state.bots.every((b) => b.state === "unknown" && !b.reachable && b.uptimeSeconds === null)).toBe(true);
  });

  it("lit le bot principal dans la ligne « primary » et les autres dans leur propre ligne", () => {
    const state = buildConsoleState({ rows: [row("primary"), row("guard", { connected: false })], activity: [], commands: [], now });
    expect(state.bots.find((b) => b.id === "fwu")).toMatchObject({ state: "online", uptimeSeconds: 3600, prefix: null });
    // Discord déconnecté mais le processus répond encore : hors ligne, et il peut lire un ordre.
    expect(state.bots.find((b) => b.id === "guard")).toMatchObject({ state: "offline", reachable: true, prefix: "+" });
  });

  it("passe un bot hors ligne et injoignable après 70 secondes sans signal", () => {
    const state = buildConsoleState({ rows: [row("primary", { last_seen: iso(now - 71_000) })], activity: [], commands: [], now });
    expect(state.bots[0]).toMatchObject({ state: "offline", reachable: false, uptimeSeconds: null });
  });

  it("expose les vraies commandes de chaque bot, tirées du fichier de profils", () => {
    const state = buildConsoleState({ rows: [], activity: [], commands: [], now });
    for (const bot of state.bots) expect(bot.commands.slash).toEqual([...SLASH_COMMAND_OWNERS[bot.id]]);
    expect(state.bots.find((b) => b.id === "fwu")?.commands.prefix).toEqual([]);
    expect(state.bots.find((b) => b.id === "investplus")?.prefix).toBe("$");
    expect(state.bots.find((b) => b.id === "fdpdlavoc")?.commands.prefix).toEqual(expect.arrayContaining(["mv", "accessall", "mvall"]));
  });

  it("fusionne les événements des bots du plus récent au plus ancien, avec libellé, famille et gravité", () => {
    const state = buildConsoleState({
      rows: [
        row("primary", { events: [{ at: iso(now - 60_000), code: "sync_ok" }] }),
        row("guard", { events: [{ at: iso(now - 10_000), code: "antinuke_triggered" }, { at: iso(now - 90_000), code: "tempban_error" }] }),
      ],
      activity: [], commands: [], now,
    });
    expect(state.events.map((e) => e.code)).toEqual(["antinuke_triggered", "sync_ok", "tempban_error"]);
    expect(state.events[0]).toMatchObject({ bot: "guard", label: EVENT_LABELS.antinuke_triggered, category: "securite", severity: 2 });
    expect(state.events[2]).toMatchObject({ category: "moderation", severity: 1 });
  });

  it("ignore tout événement qui ne vient pas de la liste fixe", () => {
    const state = buildConsoleState({ rows: [row("primary", { events: [{ at: iso(now), code: "sync_ok" }, { at: iso(now), code: "message de pirate" }, { at: "n'importe quoi", code: "sync_ok" }, 7, null] })], activity: [], commands: [], now });
    expect(state.events).toHaveLength(1);
  });

  it("ramène un horodatage futur à maintenant", () => {
    const state = buildConsoleState({ rows: [row("primary", { events: [{ at: iso(now + 3_600_000), code: "sync_ok" }] })], activity: [], commands: [], now });
    expect(Date.parse(state.events[0]!.at)).toBe(now);
  });

  it("donne une famille et une gravité à chaque code connu", () => {
    for (const code of runtimeEventCodes) {
      expect(["moderation", "securite", "vocal", "roles", "systeme", "economie", "communaute"]).toContain(eventCategory(code));
      expect([0, 1, 2]).toContain(eventSeverity(code));
    }
    expect(eventSeverity("health_critical")).toBe(2);
    expect(eventSeverity("sync_ok")).toBe(0);
  });

  it("suit le dernier ordre de redémarrage de chaque bot", () => {
    const cmd: BotCommand = { id: "123e4567-e89b-12d3-a456-426614174000", profile: "guard", action: "restart", status: "delivered", requestedAt: iso(now - 20_000), requestedBy: "1", deliveredAt: iso(now - 10_000) };
    const state = buildConsoleState({ rows: [row("guard", { started_at: iso(now - 2_000) })], activity: [], commands: [cmd], now });
    expect(state.bots.find((b) => b.id === "guard")?.restart).toMatchObject({ phase: "restarted", requestedBy: "1" });
    expect(state.bots.find((b) => b.id === "fisc")?.restart.phase).toBe("idle");
  });

  it("résume l'activité sur 30 jours et marque les données anciennes", () => {
    const snap = {
      guildId: "123456789012345678", guildName: "Serveur", levelsEnabled: true, rankedMembers: 12,
      topXp: [{ userId: "1234567", displayName: "A", xp: 100, level: 3, messages: 5, voiceMinutes: 1 }],
      daily: [{ day: "2026-11-26", messages: 40, joins: 2, leaves: 1 }, { day: "2026-11-27", messages: 10, joins: 0, leaves: 0 }],
      animation: null, capturedAt: iso(now - 60 * 60_000),
    };
    const state = buildConsoleState({ rows: [], activity: [snap], commands: [], now });
    expect(state.activity[0]).toMatchObject({ stale: true, rankedMembers: 12, totals: { messages: 50, joins: 2, leaves: 1 } });
    expect(state.activity[0]!.daily).toHaveLength(30);
  });
});

describe("console health light and restart history", () => {
  it("is red when a required bot is down, orange on recent warnings, green otherwise", async () => {
    const { computeHealth } = await import("@/lib/console-state");
    const now = Date.parse("2026-11-28T10:00:00Z");
    const bot = (label: string, state: "online" | "offline", optional = false, reachable = true) => ({ label, state, optional, reachable }) as never;
    expect(computeHealth([bot("GUARD", "online"), bot("Invest +", "online", true)], [], now)).toEqual({ level: "ok", reasons: [] });
    const red = computeHealth([bot("GUARD", "offline", false, false)], [], now);
    expect(red.level).toBe("down");
    expect(red.reasons[0]).toContain("ne répond plus");
    const ev = [{ at: "2026-11-28T09:30:00Z", code: "vps_health_warning", label: "VPS saturé" }] as never;
    expect(computeHealth([bot("GUARD", "online")], ev, now)).toEqual({ level: "warn", reasons: ["VPS saturé"] });
    const old = [{ at: "2026-11-28T07:00:00Z", code: "vps_health_warning", label: "VPS saturé" }] as never;
    expect(computeHealth([bot("GUARD", "online")], old, now).level).toBe("ok");
  });
});
