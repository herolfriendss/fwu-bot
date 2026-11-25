import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBackupLine, readBackupStatus } from "./backup-status.js";

test("ligne de sauvegarde : absente, échouée, trop vieille, sans copie distante, ok", () => {
  const now = 1_800_000_000;
  assert.match(formatBackupLine(null, now), /pas encore installées/);
  assert.match(formatBackupLine({ ok: false, step: "pg_dump a échoué.", at: now - 60 }, now), /🔴.*échouée.*pg_dump/);
  assert.match(formatBackupLine({ ok: true, at: now - 40 * 3600, offsite: true }, now), /plus de 36 h/);
  assert.match(formatBackupLine({ ok: true, at: now - 3600, offsite: false }, now), /🟧.*sans copie hors du VPS/);
  assert.match(formatBackupLine({ ok: true, at: now - 3600, offsite: true }, now), /🟢.*<t:1799996400:R>/);
});

test("lit le fichier d'état du VPS, null s'il manque", () => {
  const dir = mkdtempSync(join(tmpdir(), "fwu-bk-"));
  assert.equal(readBackupStatus(dir), null);
  writeFileSync(join(dir, "sauvegarde-status.json"), JSON.stringify({ ok: true, at: 1 }));
  assert.deepEqual(readBackupStatus(dir), { ok: true, at: 1 });
});
