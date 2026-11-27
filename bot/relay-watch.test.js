import test from "node:test";
import assert from "node:assert/strict";
import { createRelayWatcher, degradedPlan, restorePlan } from "./relay-watch.js";

test("relay alerts fire once a change lasts two checks", () => {
  const w = createRelayWatcher();
  assert.deepEqual(w.update(["guard"]), { started: [], stopped: [] }, "un seul relevé : rien");
  assert.deepEqual(w.update(["guard", "fisc"]), { started: ["guard"], stopped: [] }, "fisc n'est pas un domaine de sécurité");
  assert.deepEqual(w.update(["guard"]), { started: [], stopped: [] });
  assert.deepEqual(w.update([]), { started: [], stopped: [] });
  assert.deepEqual(w.update(["guard"]), { started: [], stopped: [] }, "retour bref : le compteur repart");
  w.update([]);
  assert.deepEqual(w.update([]), { started: [], stopped: ["guard"] });
});

test("degraded mode raises verification once and restores only its own change", () => {
  assert.deepEqual(degradedPlan(1, undefined), { change: true, to: 3, previous: 1 });
  assert.deepEqual(degradedPlan(4, undefined), { change: false }, "déjà plus strict");
  assert.deepEqual(degradedPlan(1, 1), { change: false }, "déjà en mode dégradé");
  assert.deepEqual(restorePlan(3, 1), { change: true, to: 1 });
  assert.deepEqual(restorePlan(2, 1), { change: false }, "modifié à la main entre-temps");
  assert.deepEqual(restorePlan(3, undefined), { change: false });
});
