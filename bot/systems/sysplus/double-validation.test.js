import { test } from "node:test";
import assert from "node:assert/strict";
import { createPendingGrant, decidePendingGrant, doubleValidationEnabled, setDoubleValidation, DOUBLE_VALIDATION } from "./double-validation.js";

const G = "523456789012345678"; const T0 = 1_700_000_000_000;
const make = (over = {}) => createPendingGrant({ guildId: G, userId: "u1", roleId: "r1", requestedBy: "owner", ...over }, T0);

test("réglage : désactivé par défaut, bascule par serveur", () => {
  assert.equal(doubleValidationEnabled(G), false);
  setDoubleValidation(G, true);
  assert.equal(doubleValidationEnabled(G), true);
  assert.equal(doubleValidationEnabled("623456789012345678"), false);
  setDoubleValidation(G, false);
});

test("le demandeur ne valide pas sa propre demande, un autre oui, une seule fois", () => {
  const id = make();
  assert.throws(() => decidePendingGrant(id, "owner", true, T0 + 1000), /propre demande/);
  const row = decidePendingGrant(id, "autre", true, T0 + 1000);
  assert.equal(row.user_id, "u1");
  assert.throws(() => decidePendingGrant(id, "autre2", true, T0 + 2000), /déjà traitée/);
});

test("expiration à 24 h et refus possibles, rien n'est accordé", () => {
  const id = make();
  assert.throws(() => decidePendingGrant(id, "autre", true, T0 + DOUBLE_VALIDATION.ttlMs + 1), /expiré/);
  const id2 = make();
  decidePendingGrant(id2, "autre", false, T0 + 5);
  assert.throws(() => decidePendingGrant(id2, "autre", true, T0 + 6), /déjà traitée/);
});

test("une nouvelle demande remplace l'ancienne pour le même membre", () => {
  const a = make(); const b = make();
  assert.throws(() => decidePendingGrant(a, "autre", true, T0 + 1), /déjà traitée/);
  assert.ok(decidePendingGrant(b, "autre", true, T0 + 1));
});
