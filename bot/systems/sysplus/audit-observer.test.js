import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-audobs-")), "db.sqlite");
const { recordSysPlusAudit, listSysPlusAudit, setSysPlusAuditObserver, isSensitiveSysPlusAction } = await import("./audit.js");
const G = "123456789012345678";

test("S1 : seules les actions qui changent des droits partent au Logs Hub, et une erreur ne bloque pas l'audit", () => {
  const seen = [];
  setSysPlusAuditObserver((entry) => { seen.push(entry.action); if (entry.action === "whitelist.role.update") throw new Error("hub down"); });
  recordSysPlusAudit(G, "1", "adminplus.role.update", "2", { roleId: "3" });
  recordSysPlusAudit(G, "1", "waouf.phrase_add", null, null);
  recordSysPlusAudit(G, "1", "whitelist.role.update", "4", null);
  assert.deepEqual(seen, ["adminplus.role.update", "whitelist.role.update"]);
  assert.equal(listSysPlusAudit(G, 10).length, 3, "tout reste dans le journal local");
  assert.equal(isSensitiveSysPlusAction("sysplus.member_role.create"), true);
  assert.equal(isSensitiveSysPlusAction("ticket.open"), false);
  setSysPlusAuditObserver(null);
});

test("S1 : filtre par membre (auteur ou cible) et par début d'action, sans joker SQL", () => {
  recordSysPlusAudit(G, "9", "ticket.open", "1", null);
  assert.deepEqual(listSysPlusAudit(G, 25, { memberId: "4" }).map((r) => r.action), ["whitelist.role.update"]);
  assert.equal(listSysPlusAudit(G, 25, { memberId: "1" }).length, 4, "auteur ou cible");
  assert.deepEqual(listSysPlusAudit(G, 25, { action: "adminplus" }).map((r) => r.action), ["adminplus.role.update"]);
  assert.equal(listSysPlusAudit(G, 25, { action: "%" }).length, 0, "% n'est pas un joker");
});
