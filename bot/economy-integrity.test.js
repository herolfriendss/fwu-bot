import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-ledger-integrity-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { reconcileEconomyGuild } = await import("./economy-integrity.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("economy ledger rejects updates and deletes", () => {
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES('123456','234567',10,0)").run();
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES('123456','234567',10,'test',1)").run();
  assert.throws(() => db.prepare("UPDATE economy_ledger SET delta=100 WHERE guild_id='123456'").run(), /append.only/i);
  assert.throws(() => db.prepare("DELETE FROM economy_ledger WHERE guild_id='123456'").run(), /append.only/i);
  assert.equal(db.prepare("SELECT delta FROM economy_ledger WHERE guild_id='123456'").get().delta, 10);
});

test("reconciliation reports drift without attempting a repair", () => {
  const good = reconcileEconomyGuild("123456");
  assert.equal(good.ok, true);
  db.prepare("UPDATE wallets SET balance=11 WHERE guild_id='123456' AND user_id='234567'").run();
  const report = reconcileEconomyGuild("123456");
  assert.equal(report.ok, false);
  assert.deepEqual(report.issues[0], { accountType: "member", accountId: "234567", stored: 11, ledger: 10 });
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id='123456'").get().balance, 11);
});
