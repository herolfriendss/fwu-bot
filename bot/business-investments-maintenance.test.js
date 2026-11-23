import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-invest-maintenance-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { createInvestment } = await import("./business-investments.js");
const { runInvestmentMaintenance } = await import("./business-investments-maintenance.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("daily investment maintenance is allowlisted, deterministic and idempotent", () => {
  const guildId = "123456";
  const userId = "234567";
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,1000,0)").run(guildId, userId);
  createInvestment({ guildId, userId, principal: 500, seed: "stable-seed" });
  const now = Date.parse("2026-11-16T12:00:00.000Z");
  const client = { guilds: { cache: new Map([[guildId, { id: guildId }], ["654321", { id: "654321" }]]) } };
  const first = runInvestmentMaintenance(client, [guildId], now);
  const replay = runInvestmentMaintenance(client, [guildId], now + 60_000);
  assert.equal(first.guilds, 1);
  assert.equal(first.checked, 1);
  assert.equal(first.changed, 1);
  assert.equal(replay.checked, 1);
  assert.equal(replay.changed, 0);
  const investment = db.prepare("SELECT current_value FROM investments WHERE guild_id=?").get(guildId);
  assert.ok(investment.current_value >= 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM investment_ticks").get().count, 1);
});
