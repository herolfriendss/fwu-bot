// @vitest-environment node
// Surveillance extérieure des bots (scripts/installation/fwu-surveillance.mjs) : logique pure.
import { describe, expect, it } from "vitest";
import {
  applyMarkerReadiness,
  connectedMarkerMatchesPid,
  evaluate,
  parsePm2List,
  PROCESSES,
} from "../../scripts/installation/fwu-surveillance.mjs";

const allOnline = (restarts = 0) =>
  Object.fromEntries(
    PROCESSES.map((p: { name: string }) => [
      p.name,
      { online: true, restarts },
    ]),
  );
const MIN = 60_000;

type OptionalProcessState = { monitored?: boolean };
type ProcessStates = Record<string, OptionalProcessState>;
function processStates(state: Record<string, unknown>): ProcessStates {
  return state["processes"] as ProcessStates;
}

describe("surveillance FWU", () => {
  it("détecte un processus PM2 en ligne dont la connexion Discord n'est pas prête", () => {
    let r = evaluate(
      {},
      { processes: allOnline(), outbox: 0, diskPercent: 50, backup: null },
      0,
    );
    const notReady = {
      ...allOnline(),
      "fwu-guard": { online: true, ready: false, restarts: 0 },
    };
    r = evaluate(
      r.state,
      { processes: notReady, outbox: 0, diskPercent: 50, backup: null },
      3 * MIN,
    );
    expect(r.messages.join()).toMatch(/GUARD.*processus PM2 en ligne mais connexion Discord non confirmée/);
  });

  it("valide le marqueur de connexion avec le PID courant et refuse les marqueurs périmés", () => {
    expect(connectedMarkerMatchesPid("123 2026-11-28T12:00:00.000Z", 123)).toBe(true);
    expect(connectedMarkerMatchesPid("122 2026-11-28T12:00:00.000Z", 123)).toBe(false);
    expect(connectedMarkerMatchesPid("", 123)).toBe(false);
    const processes = { "fwu-guard": { online: true, pid: 123, restarts: 0 } };
    expect(applyMarkerReadiness(processes, { "fwu-guard": false })["fwu-guard"]?.ready).toBe(false);
  });

  it("prévient après 2 min d'arrêt seulement, une fois, puis au retour", () => {
    let r = evaluate(
      {},
      { processes: allOnline(), outbox: 0, diskPercent: 50, backup: null },
      0,
    );
    expect(r.messages).toEqual([]);
    const down = {
      ...allOnline(),
      "fwu-guard": { online: false, restarts: 0 },
    };
    r = evaluate(
      r.state,
      { processes: down, outbox: 0, diskPercent: 50, backup: null },
      1 * MIN,
    );
    expect(r.messages).toEqual([]);
    r = evaluate(
      r.state,
      { processes: down, outbox: 0, diskPercent: 50, backup: null },
      3 * MIN,
    );
    expect(r.messages).toEqual([
      expect.stringMatching(/🔴 \*\*GUARD\*\* arrêté depuis 2 min/),
    ]);
    r = evaluate(
      r.state,
      { processes: down, outbox: 0, diskPercent: 50, backup: null },
      4 * MIN,
    );
    expect(r.messages).toEqual([]);
    r = evaluate(
      r.state,
      { processes: allOnline(), outbox: 0, diskPercent: 50, backup: null },
      5 * MIN,
    );
    expect(r.messages).toEqual([
      expect.stringMatching(/🟢 \*\*GUARD\*\* revenu/),
    ]);
  });

  it("un processus absent de PM2 compte comme arrêté ; PM2 muet est signalé", () => {
    const { "fwu-fisc": _gone, ...rest } = allOnline();
    let r = evaluate(
      {},
      { processes: rest, outbox: null, diskPercent: null, backup: null },
      0,
    );
    r = evaluate(
      r.state,
      { processes: rest, outbox: null, diskPercent: null, backup: null },
      2 * MIN,
    );
    expect(r.messages.join()).toMatch(/LE FISC/);
    r = evaluate(
      r.state,
      { processes: null, outbox: null, diskPercent: null, backup: null },
      3 * MIN,
    );
    expect(r.messages).toEqual([expect.stringMatching(/PM2 ne répond pas/)]);
  });

  it("ignore Invest + tant qu'il n'a jamais été installé", () => {
    const processes = allOnline();
    delete processes["fwu-investplus"];

    let r = evaluate(
      {},
      { processes, outbox: 0, diskPercent: 50, backup: null },
      0,
    );
    expect(r.messages).toEqual([]);
    expect(processStates(r.state)["fwu-investplus"]?.monitored).toBe(false);

    r = evaluate(
      r.state,
      { processes, outbox: 0, diskPercent: 50, backup: null },
      10 * MIN,
    );
    expect(r.messages.some((message) => message.includes("Invest +"))).toBe(false);
  });

  it("surveille Invest + après sa première apparition dans PM2", () => {
    let r = evaluate(
      {},
      { processes: allOnline(), outbox: 0, diskPercent: 50, backup: null },
      0,
    );
    expect(processStates(r.state)["fwu-investplus"]?.monitored).toBe(true);

    const processes = allOnline();
    delete processes["fwu-investplus"];
    r = evaluate(
      r.state,
      { processes, outbox: 0, diskPercent: 50, backup: null },
      MIN,
    );
    expect(r.messages).toEqual([]);

    r = evaluate(
      r.state,
      { processes, outbox: 0, diskPercent: 50, backup: null },
      3 * MIN,
    );
    expect(r.messages.join("\n")).toMatch(/Invest \+\*\* arrêté depuis 2 min/);
  });

  it("redémarrages en boucle, logs en attente, disque plein et sauvegarde", () => {
    const T = 1_800_000_000_000;
    const at = T / 1000;
    let r = evaluate(
      {},
      {
        processes: allOnline(5),
        outbox: 10,
        diskPercent: 82,
        backup: { ok: true, at },
      },
      T,
    );
    expect(r.messages).toEqual([]);
    r = evaluate(
      r.state,
      {
        processes: {
          ...allOnline(5),
          "fwu-suckme": { online: true, restarts: 8 },
        },
        outbox: 60,
        diskPercent: 91,
        backup: { ok: false, at, step: "pg_dump" },
      },
      T + MIN,
    );
    const text = r.messages.join("\n");
    expect(text).toMatch(/SUCK ME\*\* a redémarré 3 fois/);
    expect(text).toMatch(/60 logs/);
    expect(text).toMatch(/Disque du VPS rempli à 91 %/);
    expect(text).toMatch(/sauvegarde échouée : pg_dump/);
    r = evaluate(
      r.state,
      {
        processes: {
          ...allOnline(5),
          "fwu-suckme": { online: true, restarts: 8 },
        },
        outbox: 5,
        diskPercent: 80,
        backup: { ok: true, at: at + 120 },
      },
      T + 2 * MIN,
    );
    expect(r.messages).toHaveLength(3);
    r = evaluate(
      r.state,
      {
        processes: allOnline(5),
        outbox: 5,
        diskPercent: 80,
        backup: { ok: true, at: at + 120 },
      },
      T + 40 * 60 * MIN,
    );
    expect(r.messages.join()).toMatch(/plus de 36 h/);
  });

  it("lit la sortie de pm2 jlist", () => {
    expect(
      parsePm2List(
        JSON.stringify([
          {
            name: "fwu-guard",
            pm2_env: { status: "stopped", restart_time: 4 },
          },
        ]),
      ),
    ).toEqual({ "fwu-guard": { online: false, restarts: 4, pid: null } });
    expect(parsePm2List("pas du json")).toBeNull();
  });
});
