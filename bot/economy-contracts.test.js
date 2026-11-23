import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-economy-contracts-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const {
  approveEconomyContract,
  cancelEconomyContract,
  claimEconomyContract,
  createEconomyContract,
  grantPnd,
  listEconomyContracts,
  pndBalance,
  submitEconomyContract,
} = await import("./economy.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("contracts escrow, claim, submit, approve exactly once and isolate each guild", () => {
  grantPnd("guild-a", "creator", 75, "test_seed");
  const created = createEconomyContract("guild-a", "creator", {
    title: "Construire un événement",
    description: "Préparer le salon et le programme",
    reward: 75,
  });
  assert.equal(pndBalance("guild-a", "creator").balance, 0);
  assert.equal(listEconomyContracts("guild-b").length, 0);
  assert.throws(() => claimEconomyContract("guild-a", "creator", created), /propre contrat/);

  claimEconomyContract("guild-a", "worker", created);
  assert.throws(() => claimEconomyContract("guild-a", "other", created), /plus disponible/);
  assert.throws(() => submitEconomyContract("guild-a", "other", created, "Fait"), /Seule la personne/);
  submitEconomyContract("guild-a", "worker", created, "Événement préparé");
  assert.throws(() => approveEconomyContract("guild-a", "other", created), /Seul l’auteur/);
  assert.equal(pndBalance("guild-a", "worker").balance, 0);
  approveEconomyContract("guild-a", "creator", created);
  assert.equal(pndBalance("guild-a", "worker").balance, 75);
  assert.throws(() => approveEconomyContract("guild-a", "creator", created), /pas encore/);
  assert.equal(listEconomyContracts("guild-a", "completed")[0].id, created);
  assert.equal(pndBalance("guild-b", "worker").balance, 0);
});

test("open contract cancellation refunds escrow once and invalid values never debit", () => {
  assert.throws(() => createEconomyContract("guild-a", "poor", {
    title: "Contrat", description: "Travail", reward: 20,
  }), /insuffisant/);
  assert.throws(() => createEconomyContract("guild-a", "creator", {
    title: "", description: "Travail", reward: 20,
  }), /titre/i);
  grantPnd("guild-a", "creator", 20, "test_seed");
  const id = createEconomyContract("guild-a", "creator", {
    title: "Contrat annulable", description: "Travail simple", reward: 20,
  });
  assert.equal(pndBalance("guild-a", "creator").balance, 0);
  cancelEconomyContract("guild-a", "creator", id);
  assert.equal(pndBalance("guild-a", "creator").balance, 20);
  assert.throws(() => cancelEconomyContract("guild-a", "creator", id), /ne peut plus être annulé/);
  assert.throws(() => listEconomyContracts("guild-b", "invalid"), /État/);
});
