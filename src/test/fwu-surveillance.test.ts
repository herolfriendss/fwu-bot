// @vitest-environment node
// Surveillance extérieure des bots (scripts/installation/fwu-surveillance.mjs) : logique pure.
import { describe, expect, it } from "vitest";
// @ts-expect-error script Node sans types
import {
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

describe("surveillance FWU", () => {
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
    ).toEqual({ "fwu-guard": { online: false, restarts: 4 } });
    expect(parsePm2List("pas du json")).toBeNull();
  });
});
