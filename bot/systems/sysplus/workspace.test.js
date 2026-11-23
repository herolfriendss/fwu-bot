import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-sysplus-workspace-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("../../database.js");
const { createCommandbook, getCommandbook, listCommandbooks, deleteCommandbook, searchSysPlusWorkspace } = await import("./workspace.js");
const auth = () => true;

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("Command Composer stores bounded, server-scoped, non-executable runbooks", () => {
  const item = createCommandbook("123456", "654321", { name: "raid-response", description: "Procédure de réponse à un raid", body: "1. Vérifier les arrivées. 2. Activer le mode lent. 3. Escalader au propriétaire." }, { authorizeActor: auth, now: 1000 });
  assert.equal(item.name, "raid-response");
  assert.equal(getCommandbook("999999", item.id), null);
  assert.equal(listCommandbooks("123456").length, 1);
  assert.throws(() => createCommandbook("123456", "654321", { name: "bad name", description: "description valide", body: "Contenu assez long pour passer." }, { authorizeActor: auth }), /Nom invalide/);
  assert.throws(() => createCommandbook("123456", "654321", { name: "no-auth", description: "description valide", body: "Contenu assez long pour passer." }), /SYS\+/);
  assert.equal(deleteCommandbook("123456", "654321", item.id, { authorizeActor: auth }).id, item.id);
  assert.equal(getCommandbook("123456", item.id), null);
});

test("Smart Search indexes only SYS+ workspace metadata and is guild-isolated", () => {
  const item = createCommandbook("123456", "654321", { name: "ticket-escalation", description: "Escalade des tickets urgents", body: "Consulter le dossier puis assigner un responsable." }, { authorizeActor: auth, now: 1000 });
  db.prepare("INSERT INTO sysplus_audit(guild_id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)")
    .run("123456", "654321", "ticket.escalated", "777777", JSON.stringify({ reason: "urgent" }), 2000);
  const results = searchSysPlusWorkspace("123456", "ticket urgent");
  assert.ok(results.some((result) => result.type === "runbook" && result.id === item.id));
  assert.ok(results.some((result) => result.type === "audit"));
  assert.equal(searchSysPlusWorkspace("999999", "ticket urgent").length, 0);
  assert.throws(() => searchSysPlusWorkspace("123456", "x"), /trop courte/);
});
