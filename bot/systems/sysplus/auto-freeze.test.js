import { test } from "node:test";
import assert from "node:assert/strict";
import { autoFreezeConfig, maybeAutoFreeze, setAutoFreeze } from "./auto-freeze.js";

const G = "823456789012345678";
const fakes = (existing = null) => {
  const calls = [];
  return { calls, setFreeze: async (a) => { calls.push(a); return { until: 123 }; }, getFreeze: async () => existing, remember: () => {} };
};

test("désactivé par défaut : rien ne se gèle", async () => {
  const f = fakes();
  assert.equal(autoFreezeConfig(G).enabled, false);
  assert.deepEqual(await maybeAutoFreeze({ guildId: G, botId: "b", bot: "guard", reason: "x", ...f }), { frozen: false, why: "off" });
  assert.equal(f.calls.length, 0);
});

test("actif : gel de la durée réglée, au nom du bot ; pas de second gel", async () => {
  setAutoFreeze(G, { enabled: true, minutes: 45 });
  const f = fakes();
  const r = await maybeAutoFreeze({ guildId: G, botId: "b", bot: "guard", reason: "ban par 1", ...f });
  assert.equal(r.frozen, true); assert.equal(f.calls[0].seconds, 2700); assert.equal(f.calls[0].actorId, "b");
  const again = await maybeAutoFreeze({ guildId: G, botId: "b", bot: "guard", reason: "x", ...fakes({ until: 1 }) });
  assert.deepEqual(again, { frozen: false, why: "already" });
});

test("durée bornée et erreur de base : jamais d'exception", async () => {
  assert.throws(() => setAutoFreeze(G, { enabled: true, minutes: 2 }), /minutes/);
  const boom = { setFreeze: async () => { throw new Error("db"); }, getFreeze: async () => null, remember: () => {} };
  assert.deepEqual(await maybeAutoFreeze({ guildId: G, botId: "b", bot: "guard", reason: "x", ...boom }), { frozen: false, why: "error" });
});
