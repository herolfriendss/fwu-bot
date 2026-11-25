import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "./database.js";
import { formatHistoryEntry, loadMemberHistory, mergeMemberHistory, summarizeHistory } from "./member-history.js";
import "./guard/commands.js"; // crée la table des affaires retirées

const T = 1_700_000_000_000;

test("fusion : une sanction écrite des deux côtés n'apparaît qu'une fois, avec son numéro d'affaire", () => {
  const central = [
    { action: "tempmute", label: "Insultes", reason: "insulte", moderatorId: "m1", createdAt: new Date(T + 2000), durationSeconds: 900, bot: "fwu" },
    { action: "blacklist", reason: "raid", moderatorId: "m2", createdAt: new Date(T + 60_000), bot: "guard" },
    { action: "warn", reason: "spam", moderatorId: "m1", createdAt: new Date(T + 120_000), bot: "suckme" },
  ];
  const cases = [{ id: 7, action: "mute", reason: "Insultes — insulte", moderatorId: "m1", createdAt: T }, { id: 3, action: "kick", reason: "ancien", moderatorId: "m3", createdAt: T - 86_400_000 }];
  const removed = [{ id: 9, action: "warn", reason: "spam", moderatorId: "m1", createdAt: T + 119_000, removedBy: "s1", removalReason: "erreur de cible" }];
  const entries = mergeMemberHistory(central, cases, removed);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((e) => e.caseId), [9, null, 7, 3]);
  assert.equal(entries[0].removed, true, "l'affaire retirée reste visible, marquée");
  assert.equal(entries[2].source, "both");
  assert.equal(entries[3].source, "local");
  assert.match(formatHistoryEntry(entries[2]), /\*\*#7 · Exclusion \(Insultes\) · 15 min\*\*/);
  assert.match(formatHistoryEntry(entries[0]), /~~#9 · Avertissement~~.*retirée\*\* par <@s1> : erreur de cible/);
  assert.deepEqual(summarizeHistory(entries), { blacklist: 1, mute: 1, kick: 1 });
});

test("fusion : au-delà de 15 s ou avec un autre modérateur, pas de rapprochement", () => {
  const central = [{ action: "warn", reason: "a", moderatorId: "m1", createdAt: new Date(T + 20_000), bot: "fwu" }];
  assert.equal(mergeMemberHistory(central, [{ id: 1, action: "warn", reason: "a", moderatorId: "m1", createdAt: T }]).length, 2);
  assert.equal(mergeMemberHistory(central, [{ id: 1, action: "warn", reason: "a", moderatorId: "m2", createdAt: T + 20_000 }]).length, 2);
});

test("chargement : base centrale injoignable = casier local seul, signalé", async () => {
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .run("hist-g", "u1", "m1", "ban", "raid", JSON.stringify({ durationSeconds: null }), T);
  const down = await loadMemberHistory({ guildId: "hist-g", userId: "u1", loadCentral: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.centralAvailable, false);
  assert.equal(down.entries.length, 1);
  const up = await loadMemberHistory({ guildId: "hist-g", userId: "u1", loadCentral: async () => ({ total: 1, items: [{ action: "ban", reason: "raid", moderatorId: "m1", createdAt: new Date(T + 1000), bot: "fwu" }] }) });
  assert.equal(up.centralAvailable, true);
  assert.equal(up.entries.length, 1);
  assert.equal(up.entries[0].caseId > 0, true);
});
