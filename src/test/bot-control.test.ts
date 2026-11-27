import { describe, expect, it } from "vitest";
import {
  COMMAND_MAX_AGE_AT_BOT_MS, COMMAND_TTL_MS, RESTART_COOLDOWN_MS, RESTART_STALLED_MS,
  parseRestartRequest, restartCooldownLeftMs, restartPhase, type BotCommand,
} from "@/lib/bot-control";
import { COMMAND_MAX_AGE_MS } from "../../bot/remote-control.js";

const now = Date.parse("2026-11-27T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const command = (over: Partial<BotCommand> = {}): BotCommand => ({
  id: "123e4567-e89b-12d3-a456-426614174000", profile: "guard", action: "restart", status: "pending",
  requestedAt: iso(now - 10_000), requestedBy: "1", deliveredAt: null, ...over,
});

describe("redémarrage depuis la console", () => {
  it("garde la même limite d'âge côté site et côté bot", () => {
    expect(COMMAND_MAX_AGE_MS).toBe(COMMAND_MAX_AGE_AT_BOT_MS);
  });

  it("n'accepte qu'un bot connu, rien d'autre dans la requête", () => {
    expect(parseRestartRequest({ bot: "guard" })).toEqual({ bot: "guard" });
    expect(parseRestartRequest({ bot: "fwu" })).toEqual({ bot: "fwu" });
    for (const bad of [{ bot: "core" }, { bot: "" }, { bot: 3 }, {}, { bot: "guard", cmd: "rm -rf /" }, { bot: "__proto__" }, { bot: "toString" }, null, [], "guard"]) {
      expect(parseRestartRequest(bad)).toBeNull();
    }
  });

  it("suit l'ordre de l'attente jusqu'au redémarrage", () => {
    expect(restartPhase(null, null, now)).toBe("idle");
    expect(restartPhase(command(), iso(now - 3_600_000), now)).toBe("waiting");
    const delivered = command({ status: "delivered", deliveredAt: iso(now - 5_000) });
    expect(restartPhase(delivered, iso(now - 3_600_000), now)).toBe("sent");
    // Nouveau processus démarré après la livraison : le redémarrage a eu lieu.
    expect(restartPhase(delivered, iso(now - 1_000), now)).toBe("restarted");
  });

  it("signale un bot qui n'est pas revenu après 3 minutes", () => {
    const delivered = command({ status: "delivered", deliveredAt: iso(now - RESTART_STALLED_MS - 1_000) });
    expect(restartPhase(delivered, iso(now - 3_600_000), now)).toBe("stalled");
  });

  it("fait expirer un ordre que le bot n'a jamais lu", () => {
    expect(restartPhase(command({ requestedAt: iso(now - COMMAND_TTL_MS - 1) }), null, now)).toBe("expired");
    expect(restartPhase(command({ status: "expired" }), null, now)).toBe("expired");
  });

  it("impose un délai entre deux redémarrages du même bot", () => {
    expect(restartCooldownLeftMs(null, now)).toBe(0);
    expect(restartCooldownLeftMs(iso(now - 10_000), now)).toBe(RESTART_COOLDOWN_MS - 10_000);
    expect(restartCooldownLeftMs(iso(now - RESTART_COOLDOWN_MS - 1), now)).toBe(0);
  });
});
