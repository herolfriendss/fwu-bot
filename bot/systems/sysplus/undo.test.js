import { test } from "node:test";
import assert from "node:assert/strict";
import { recordSysPlusAudit } from "./audit.js";
import { lastUndoableGrant, UNDO_WINDOW_MS } from "./undo.js";

const G = "423456789012345678"; const O = "owner1"; const U = "user1";

test("annulation : dernière attribution de l'heure, une seule fois", () => {
  assert.equal(lastUndoableGrant(G, O), null);
  recordSysPlusAudit(G, O, "sysplus.member.add", U, {});
  const grant = lastUndoableGrant(G, O);
  assert.equal(grant.targetId, U);
  assert.equal(lastUndoableGrant(G, "autre"), null, "pas celle d'un autre");
  assert.equal(lastUndoableGrant(G, O, Date.now() + UNDO_WINDOW_MS + 5_000), null, "hors fenêtre");
  recordSysPlusAudit(G, O, "sysplus.member.undo", U, {});
  assert.equal(lastUndoableGrant(G, O), null, "déjà annulée");
});

test("annulation impossible après un retrait", () => {
  recordSysPlusAudit(G, O, "sysplus.member.add", "user2", {});
  recordSysPlusAudit(G, O, "sysplus.member.remove", "user2", {});
  assert.equal(lastUndoableGrant(G, O)?.targetId === "user2", false);
});
