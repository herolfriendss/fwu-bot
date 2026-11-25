import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-autoinc-")), "db.sqlite");
const { recordGuardIncident, resolveGuardLockdownIncident, autoIncidentNotice, MERGE_WINDOW_MS } = await import("./auto-incidents.js");
const { listSysPlusIncidents } = await import("./incidents.js");

const G = "123456789012345678";
const BOT = "223456789012345678";

test("un verrouillage ouvre un incident ; une attaque proche le complète et le passe en critique", () => {
  const first = recordGuardIncident({ guildId: G, botId: BOT, kind: "lockdown", detail: "par 1, 12 salon(s) fermés", now: 1_000_000 });
  assert.equal(first.created, true);
  assert.equal(first.incident.severity, "high");
  assert.match(autoIncidentNotice(first), /ouvert automatiquement/);
  const second = recordGuardIncident({ guildId: G, botId: BOT, kind: "nuke", detail: "Suppression de salons par @x", now: 1_000_000 + 60_000 });
  assert.equal(second.created, false);
  assert.equal(second.incident.incidentId, first.incident.incidentId, "pas de doublon");
  assert.equal(second.incident.severity, "critical");
  assert.match(second.incident.summary, /anti-nuke/);
  assert.doesNotMatch(second.incident.summary, /@x/, "aucune mention possible");
  assert.equal(listSysPlusIncidents(G, { status: "open" }).length, 1);
});

test("au déverrouillage, l'incident est résolu avec un résumé ; après 30 min un nouvel incident est créé", () => {
  const resolved = resolveGuardLockdownIncident({ guildId: G, botId: BOT, actorId: "323456789012345678", reopenedChannels: 12, now: 1_000_000 + 10 * 60_000 });
  assert.equal(resolved.status, "resolved");
  assert.match(resolved.resolution, /12 salon\(s\) rouverts/);
  assert.equal(resolveGuardLockdownIncident({ guildId: G, botId: BOT, actorId: "3", reopenedChannels: 0 }), null);
  const later = recordGuardIncident({ guildId: G, botId: BOT, kind: "nuke", detail: "x", now: 1_000_000 + MERGE_WINDOW_MS * 3 });
  assert.equal(later.created, true);
});

test("ne jette jamais, même avec un serveur invalide", () => {
  assert.deepEqual(recordGuardIncident({ guildId: "nope", botId: BOT, kind: "nuke", detail: "x" }), { incident: null, created: false });
});
