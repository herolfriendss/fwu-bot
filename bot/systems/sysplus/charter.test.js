import test from "node:test";
import assert from "node:assert/strict";
import { CHARTER_MAX, acceptCharter, getCharter, hasAccepted, pendingStaff, setCharter } from "./charter.js";

const TEXT = "1. Respecter les membres.\n2. Ne jamais sanctionner par colère.";

test("texte : bornes, version qui monte seulement si le texte change", () => {
  assert.throws(() => setCharter("g", "trop court", "a"), /trop courte/);
  assert.throws(() => setCharter("g", "x".repeat(CHARTER_MAX + 1), "a"), /trop longue/);
  assert.equal(getCharter("g"), null);
  assert.equal(setCharter("g", TEXT, "a", 1).version, 1);
  assert.equal(setCharter("g", TEXT, "a", 2).version, 1, "identique : même version");
  assert.equal(setCharter("g", `${TEXT}\n3. Rester poli.`, "a", 3).version, 2);
});

test("acceptation : valable pour la version, à refaire quand le texte change", () => {
  assert.throws(() => acceptCharter("vide", "u"), /Aucune charte/);
  assert.equal(hasAccepted("g", "u", 2), false);
  acceptCharter("g", "u", 5);
  assert.equal(hasAccepted("g", "u", 2), true);
  assert.deepEqual(pendingStaff("g", ["u", "v"], 2), ["v"]);
  setCharter("g", `${TEXT}\n4. Dire bonjour.`, "a", 6);
  assert.deepEqual(pendingStaff("g", ["u", "v"], 3), ["u", "v"], "nouvelle version : tout le monde doit ré-accepter");
});
