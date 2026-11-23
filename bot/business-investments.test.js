import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-business-investments-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const businessApi = await import("./business-investments.js");
const { reconcileEconomyGuild } = await import("./economy-integrity.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const guildId = "123456";
const ownerId = "234567";
const employeeId = "345678";
const payerId = "456789";

test("business revenue, withdrawals and payroll share the idempotent PND ledger", () => {
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0)").run(guildId, payerId, 1000);
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0)").run(guildId, ownerId, 1000);
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,'test_opening',?)").run(guildId, payerId, 1000, Date.now());
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,'test_opening',?)").run(guildId, ownerId, 1000, Date.now());

  const business = businessApi.createBusiness({ guildId, ownerId, name: "PND Studio" });
  businessApi.collectBusinessRevenue({ guildId, businessId: business.id, actorId: payerId, payerId, amount: 200, requestId: "invoice-001" });
  const duplicate = businessApi.collectBusinessRevenue({ guildId, businessId: business.id, actorId: payerId, payerId, amount: 200, requestId: "invoice-001" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, payerId).balance, 800);
  assert.equal(db.prepare("SELECT treasury FROM businesses WHERE guild_id=? AND id=?").get(guildId, business.id).treasury, 200);

  businessApi.hireBusinessEmployee({ guildId, businessId: business.id, actorId: ownerId, userId: employeeId });
  businessApi.setBusinessSalary({ guildId, businessId: business.id, actorId: ownerId, userId: employeeId, salary: 50 });
  const payroll = businessApi.runBusinessPayroll({ guildId, businessId: business.id, actorId: ownerId, periodKey: "2026-11" });
  assert.equal(payroll.paid.length, 1);
  assert.equal(payroll.unpaid.length, 0);
  const duplicatePayroll = businessApi.runBusinessPayroll({ guildId, businessId: business.id, actorId: ownerId, periodKey: "2026-11" });
  assert.equal(duplicatePayroll.paid[0].duplicate, true);
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, employeeId).balance, 50);

  businessApi.withdrawBusinessTreasury({ guildId, businessId: business.id, actorId: ownerId, amount: 25, requestId: "withdraw-001" });
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, ownerId).balance, 1025);
  assert.equal(reconcileEconomyGuild(guildId).ok, true);
});

test("business payroll is restricted to the company owner", () => {
  const business = businessApi.createBusiness({ guildId, ownerId, name: "Payroll Secure" });
  businessApi.collectBusinessRevenue({ guildId, businessId: business.id, actorId: ownerId, payerId: ownerId, amount: 50, requestId: "payroll-funding" });
  businessApi.hireBusinessEmployee({ guildId, businessId: business.id, actorId: ownerId, userId: employeeId });
  businessApi.setBusinessSalary({ guildId, businessId: business.id, actorId: ownerId, userId: employeeId, salary: 10 });
  assert.throws(
    () => businessApi.runBusinessPayroll({ guildId, businessId: business.id, actorId: payerId, periodKey: "2026-12" }),
    /Seul le propriétaire/i,
  );
  const payroll = businessApi.runBusinessPayroll({ guildId, businessId: business.id, actorId: ownerId, periodKey: "2026-12" });
  assert.equal(payroll.paid.length, 1);
  assert.equal(payroll.unpaid.length, 0);
});

test("investment ticks are deterministic, idempotent and close back to the member wallet", () => {
  const investment = businessApi.createInvestment({ guildId, userId: ownerId, principal: 100, riskBps: 500, seed: "deterministic-seed" });
  const first = businessApi.tickInvestment({ guildId, investmentId: investment.id, tickKey: "tick-1" });
  const replay = businessApi.tickInvestment({ guildId, investmentId: investment.id, tickKey: "tick-1" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.return_bps, first.returnBps);
  assert.ok(first.returnBps >= -500 && first.returnBps <= 500);
  const closed = businessApi.closeInvestment({ guildId, investmentId: investment.id, userId: ownerId, requestId: "close-1" });
  assert.equal(closed.applied, true);
  assert.equal(businessApi.listInvestments(guildId, ownerId).find((entry) => entry.id === investment.id).status, "closed");
  assert.equal(reconcileEconomyGuild(guildId).ok, true);
});

test("businesses and investments are scoped to their guild", () => {
  const business = businessApi.listBusinesses(guildId)[0];
  assert.equal(businessApi.listBusinesses("654321").length, 0);
  assert.throws(() => businessApi.getBusiness("654321", business.id), /introuvable/i);
});
