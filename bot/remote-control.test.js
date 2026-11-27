import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_MAX_AGE_MS, decideRemoteCommand } from "./remote-control.js";

const NOW = Date.parse("2026-11-27T10:00:00Z");
const ID = "123e4567-e89b-12d3-a456-426614174000";
const order = (over = {}) => ({ ok: true, command: { id: ID, action: "restart", issuedAt: "2026-11-27T09:59:30Z", ...over } });

test("aucun ordre : rien à faire", () => {
  assert.equal(decideRemoteCommand({ ok: true, command: null }, { now: NOW }), null);
  assert.equal(decideRemoteCommand({ ok: true }, { now: NOW }), null);
  assert.equal(decideRemoteCommand(null, { now: NOW }), null);
  assert.equal(decideRemoteCommand("restart", { now: NOW }), null);
});

test("un ordre de redémarrage valide et récent est exécuté", () => {
  assert.deepEqual(decideRemoteCommand(order(), { now: NOW }), { action: "restart", id: ID });
});

test("un ordre déjà traité par ce processus n'est jamais rejoué", () => {
  assert.deepEqual(decideRemoteCommand(order(), { now: NOW, seen: new Set([ID]) }), { action: "ignore", reason: "already-handled" });
});

test("un ordre trop vieux est ignoré", () => {
  const old = new Date(NOW - COMMAND_MAX_AGE_MS - 1000).toISOString();
  assert.deepEqual(decideRemoteCommand(order({ issuedAt: old }), { now: NOW }), { action: "ignore", reason: "stale" });
});

test("un ordre daté du futur est ignoré", () => {
  const future = new Date(NOW + 5 * 60_000).toISOString();
  assert.deepEqual(decideRemoteCommand(order({ issuedAt: future }), { now: NOW }), { action: "ignore", reason: "future" });
});

test("toute autre action que restart est refusée", () => {
  for (const action of ["stop", "exec", "update", "", undefined, 3]) {
    assert.deepEqual(decideRemoteCommand(order({ action }), { now: NOW }), { action: "ignore", reason: "unknown-action" });
  }
});

test("un identifiant ou un format invalide est refusé", () => {
  for (const id of ["abc", "", "../etc", 12, null]) {
    assert.deepEqual(decideRemoteCommand(order({ id }), { now: NOW }), { action: "ignore", reason: "invalid" });
  }
  assert.deepEqual(decideRemoteCommand({ command: [] }, { now: NOW }), { action: "ignore", reason: "invalid" });
  assert.deepEqual(decideRemoteCommand(order({ issuedAt: "pas une date" }), { now: NOW }), { action: "ignore", reason: "invalid" });
});

test("PND_REMOTE_RESTART=off : l'ordre est signalé mais jamais exécuté", () => {
  assert.deepEqual(decideRemoteCommand(order(), { now: NOW, enabled: false }), { action: "ignore", reason: "disabled" });
});
