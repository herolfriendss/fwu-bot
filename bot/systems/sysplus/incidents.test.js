import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-sysplus-incidents-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("../../database.js");
const { createSysPlusIncident, listSysPlusIncidents, assignSysPlusIncident, resolveSysPlusIncident, updateSysPlusIncidentStatus } = await import("./incidents.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("incident center enforces staff authorization, guild scope and a full lifecycle", () => {
  assert.throws(() => createSysPlusIncident("123456", "654321", { title: "Raid", summary: "Raid suspect" }), /SYS\+/);
  const incident = createSysPlusIncident("123456", "654321", { title: "Raid suspect", summary: "Vague d'arrivées inhabituelles", severity: "critical" }, { authorizeActor: () => true, now: 1000 });
  assert.equal(incident.status, "open");
  assert.equal(listSysPlusIncidents("123456")[0].incidentId, incident.incidentId);
  assert.equal(listSysPlusIncidents("999999").length, 0);
  const assigned = assignSysPlusIncident("123456", incident.incidentId, "654321", "777777", { authorizeActor: () => true, now: 2000 });
  assert.equal(assigned.assignedTo, "777777");
  assert.equal(assigned.status, "in_progress");
  const reopened = updateSysPlusIncidentStatus("123456", incident.incidentId, "654321", "open", { authorizeActor: () => true, now: 2500 });
  assert.equal(reopened.status, "open");
  assert.throws(() => updateSysPlusIncidentStatus("123456", incident.incidentId, "654321", "resolved", { authorizeActor: () => true }), /commande de résolution/);
  const resolved = resolveSysPlusIncident("123456", incident.incidentId, "654321", "Compte compromis isolé et accès révoqués", { authorizeActor: () => true, now: 3000 });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedBy, "654321");
  assert.throws(() => assignSysPlusIncident("123456", incident.incidentId, "654321", "888888", { authorizeActor: () => true }), /déjà résolu/);
});
