import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  addEvidence, addNote, assignIntervention, checkEvidence, checkReference, closeIntervention, formatIntervention,
  getIntervention, interventionCounts, listInterventions, MAX_EVIDENCE, openIntervention, staleInterventions, validateIntervention,
} from "./staff-interventions.js";

const G = "111111111111111111";
const mem = () => new DatabaseSync(":memory:");

test("numbers are unique per server and titles are cleaned", () => {
  const db = mem();
  assert.equal(openIntervention({ guildId: G, actorId: "a", title: "Raid @everyone" }, { db }).number, 1);
  assert.equal(openIntervention({ guildId: G, actorId: "a", title: "Plainte" }, { db }).number, 2);
  assert.equal(openIntervention({ guildId: "g2", actorId: "a", title: "Autre" }, { db }).number, 1);
  assert.doesNotMatch(getIntervention(G, 1, { db }).title, /@everyone/);
  assert.match(openIntervention({ guildId: G, actorId: "a", title: "  " }, { db }).error, /titre/);
  assert.equal(getIntervention("g2", 2, { db }), null); // isolation
});

test("evidence: https only, Discord message links of this server only, references", () => {
  assert.ok(checkEvidence("https://imgur.com/a.png", G).link);
  assert.match(checkEvidence("http://x.y", G).error, /https/);
  assert.match(checkEvidence("javascript:alert(1)", G).error, /https|invalide/);
  assert.ok(checkEvidence(`https://discord.com/channels/${G}/2/3`, G).link);
  assert.match(checkEvidence("https://discord.com/channels/999999999999999999/2/3", G).error, /autre serveur/);
  assert.deepEqual(checkReference("sanction:12"), { reference: "sanction:12" });
  assert.deepEqual(checkReference("Journal #34"), { reference: "journal:34" });
  assert.match(checkReference("salut").error, /Référence/);
});

test("full life cycle with history kept in order", () => {
  const db = mem();
  openIntervention({ guildId: G, actorId: "op", title: "Insultes en vocal", targetId: "t" }, { db });
  assert.ok(assignIntervention({ guildId: G, number: 1, actorId: "op", assigneeId: "mod" }, { db }).ok);
  assert.ok(addEvidence({ guildId: G, number: 1, actorId: "mod", link: "https://imgur.com/p.png" }, { db }).ok);
  assert.equal(addEvidence({ guildId: G, number: 1, actorId: "mod", link: "sanction:4" }, { db }).value, "sanction:4");
  assert.ok(addNote({ guildId: G, number: 1, actorId: "mod", text: "Témoins entendus" }, { db }).ok);
  assert.match(closeIntervention({ guildId: G, number: 1, actorId: "random", resolution: "x" }, { db }).error, /Seuls/);
  assert.deepEqual(closeIntervention({ guildId: G, number: 1, actorId: "mod", resolution: "Avertissement donné" }, { db }), { ok: true, pending: false });
  const file = getIntervention(G, 1, { db });
  assert.equal(file.status, "closed");
  assert.deepEqual(file.events.map((e) => e.kind), ["open", "assign", "evidence", "link", "note", "close"]);
  assert.match(formatIntervention(file), /Dossier n°1/);
  assert.match(addNote({ guildId: G, number: 1, actorId: "mod", text: "trop tard" }, { db }).error, /clos/);
});

test("high priority needs a secondary validation by another manager", () => {
  const db = mem();
  openIntervention({ guildId: G, actorId: "op", title: "Abus d'un modérateur", priority: "haute" }, { db });
  assert.deepEqual(closeIntervention({ guildId: G, number: 1, actorId: "sys1", resolution: "Rétrogradé", canManage: true }, { db }), { ok: true, pending: true });
  assert.match(closeIntervention({ guildId: G, number: 1, actorId: "sys1", resolution: "x", canManage: true }, { db }).error, /déjà demandée/);
  assert.match(validateIntervention({ guildId: G, number: 1, actorId: "sys1", canManage: true }, { db }).error, /autre responsable/);
  assert.match(validateIntervention({ guildId: G, number: 1, actorId: "mod", canManage: false }, { db }).error, /réservée/);
  assert.match(assignIntervention({ guildId: G, number: 1, actorId: "op", assigneeId: "x" }, { db }).error, /validation/);
  assert.deepEqual(listInterventions(G, { status: "a_valider", db }).map((r) => r.number), [1]);
  assert.ok(validateIntervention({ guildId: G, number: 1, actorId: "sys2", canManage: true }, { db }).ok);
  assert.equal(getIntervention(G, 1, { db }).validated_by, "sys2");
  assert.match(validateIntervention({ guildId: G, number: 1, actorId: "sys3", canManage: true }, { db }).error, /n'attend pas/);
});

test("lists, counters, evidence limit and stale files", () => {
  const db = mem();
  openIntervention({ guildId: G, actorId: "a", title: "Basse", priority: "basse" }, { db, now: 0 });
  openIntervention({ guildId: G, actorId: "a", title: "Haute", priority: "haute" }, { db, now: 0 });
  assert.deepEqual(listInterventions(G, { db }).map((r) => r.title), ["Haute", "Basse"]);
  assert.deepEqual(interventionCounts(G, { db }), { open: 2 });
  for (let i = 0; i < MAX_EVIDENCE; i++) addEvidence({ guildId: G, number: 1, actorId: "a", link: `https://ex.com/${i}` }, { db, now: 0 });
  assert.match(addEvidence({ guildId: G, number: 1, actorId: "a", link: "https://ex.com/x" }, { db, now: 0 }).error, /Maximum/);
  assert.equal(staleInterventions({ db, now: 49 * 3_600_000 }).length, 2);
});
