import { createHash, randomUUID } from "node:crypto";
import { db, transaction } from "./database.js";
import { applyEconomyOperation } from "./economy-operations.js";

const MAX_AMOUNT = 1_000_000_000;
const cleanName = (value) => {
  if (typeof value !== "string") throw new Error("Nom d'entreprise invalide.");
  const name = value.replace(/@/g, "＠").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 40) throw new Error("Le nom doit contenir entre 3 et 40 caractères.");
  return name;
};
const amount = (value, label = "Montant") => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT) throw new Error(`${label} compris entre 1 et ${MAX_AMOUNT} PND attendu.`);
  return value;
};
const businessOf = (guildId, businessId) => {
  const row = db.prepare("SELECT * FROM businesses WHERE guild_id=? AND id=?").get(guildId, businessId);
  if (!row) throw new Error("Entreprise introuvable sur ce serveur.");
  return row;
};
const requireOwner = (business, actorId) => {
  if (business.owner_id !== actorId) throw new Error("Seul le propriétaire de l'entreprise peut effectuer cette action.");
};

export function createBusiness({ guildId, ownerId, name, now = Date.now() }) {
  const title = cleanName(name);
  if (!/^\d{5,25}$/.test(guildId ?? "") || !/^\d{5,25}$/.test(ownerId ?? "")) throw new Error("Serveur ou propriétaire Discord invalide.");
  const id = randomUUID();
  return transaction(() => {
    db.prepare("INSERT INTO businesses(id,guild_id,owner_id,name,treasury,created_at,updated_at) VALUES(?,?,?,?,0,?,?)")
      .run(id, guildId, ownerId, title, now, now);
    db.prepare("INSERT INTO business_members(guild_id,business_id,user_id,role,salary,joined_at) VALUES(?,?,?,'owner',0,?)")
      .run(guildId, id, ownerId, now);
    return { id, guildId, ownerId, name: title, treasury: 0, createdAt: now };
  });
}

export function getBusiness(guildId, businessId) {
  const business = businessOf(guildId, businessId);
  const employees = db.prepare("SELECT user_id,role,salary,joined_at FROM business_members WHERE guild_id=? AND business_id=? ORDER BY role,user_id")
    .all(guildId, businessId);
  return { ...business, employees };
}

export function listBusinesses(guildId, limit = 20) {
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT id,owner_id,name,treasury,created_at FROM businesses WHERE guild_id=? ORDER BY created_at DESC LIMIT ?")
    .all(guildId, bounded);
}

export function hireBusinessEmployee({ guildId, businessId, actorId, userId, now = Date.now() }) {
  if (!/^\d{5,25}$/.test(userId ?? "") || userId === actorId) throw new Error("Membre employé invalide.");
  const business = businessOf(guildId, businessId);
  requireOwner(business, actorId);
  db.prepare("INSERT INTO business_members(guild_id,business_id,user_id,role,salary,joined_at) VALUES(?,?,?,'employee',0,?)")
    .run(guildId, businessId, userId, now);
  return { businessId, userId, salary: 0 };
}

export function setBusinessSalary({ guildId, businessId, actorId, userId, salary }) {
  const business = businessOf(guildId, businessId);
  requireOwner(business, actorId);
  if (!Number.isSafeInteger(salary) || salary < 0 || salary > MAX_AMOUNT) throw new Error("Salaire invalide.");
  const updated = db.prepare("UPDATE business_members SET salary=? WHERE guild_id=? AND business_id=? AND user_id=? AND role='employee'")
    .run(salary, guildId, businessId, userId);
  if (!Number(updated.changes)) throw new Error("Employé introuvable.");
  return { businessId, userId, salary };
}

export function removeBusinessEmployee({ guildId, businessId, actorId, userId }) {
  const business = businessOf(guildId, businessId);
  if (business.owner_id !== actorId && actorId !== userId) throw new Error("Action réservée au propriétaire ou à l'employé concerné.");
  const removed = db.prepare("DELETE FROM business_members WHERE guild_id=? AND business_id=? AND user_id=? AND role='employee'")
    .run(guildId, businessId, userId);
  if (!Number(removed.changes)) throw new Error("Employé introuvable ou membre propriétaire.");
  return true;
}

/** Owner-authorized revenue: payer's wallet -> business treasury via the PND ledger. */
export function collectBusinessRevenue({ guildId, businessId, actorId, payerId, amount: value, requestId, now = Date.now() }) {
  const business = businessOf(guildId, businessId);
  const price = amount(value, "Contribution");
  if (!/^\d{5,25}$/.test(payerId ?? "") || actorId !== payerId) throw new Error("Chaque contribution doit être initiée par le membre qui la paie.");
  return applyEconomyOperation({
    guildId,
    operationId: `business-revenue:${businessId}:${requestId}`,
    reason: "business_revenue",
    now,
    postings: [
      { accountType: "member", accountId: payerId, delta: -price },
      { accountType: "business", accountId: businessId, delta: price },
    ],
  });
}

export function withdrawBusinessTreasury({ guildId, businessId, actorId, amount: value, requestId, now = Date.now() }) {
  const business = businessOf(guildId, businessId);
  requireOwner(business, actorId);
  const payout = amount(value, "Retrait");
  return applyEconomyOperation({
    guildId,
    operationId: `business-withdraw:${businessId}:${requestId}`,
    reason: "business_withdrawal",
    now,
    postings: [
      { accountType: "business", accountId: businessId, delta: -payout },
      { accountType: "member", accountId: actorId, delta: payout },
    ],
  });
}

export function runBusinessPayroll({ guildId, businessId, actorId, periodKey, now = Date.now() }) {
  if (!/^\d{5,25}$/.test(actorId ?? "")) throw new Error("Identité du responsable invalide.");
  if (typeof periodKey !== "string" || !/^[a-zA-Z0-9:_-]{1,80}$/.test(periodKey)) throw new Error("Période de paie invalide.");
  const business = businessOf(guildId, businessId);
  requireOwner(business, actorId);
  const employees = db.prepare("SELECT user_id,salary FROM business_members WHERE guild_id=? AND business_id=? AND role='employee' AND salary>0 ORDER BY user_id")
    .all(guildId, businessId);
  const result = { paid: [], unpaid: [] };
  for (const employee of employees) {
    try {
      const transfer = applyEconomyOperation({
        guildId,
        operationId: `business-payroll:${businessId}:${periodKey}:${employee.user_id}`,
        reason: "business_payroll",
        now,
        postings: [
          { accountType: "business", accountId: businessId, delta: -Number(employee.salary) },
          { accountType: "member", accountId: employee.user_id, delta: Number(employee.salary) },
        ],
      });
      result.paid.push({ userId: employee.user_id, salary: Number(employee.salary), duplicate: transfer.duplicate });
    } catch (error) {
      result.unpaid.push({ userId: employee.user_id, salary: Number(employee.salary), reason: error instanceof Error ? error.message : "Échec de paie" });
    }
  }
  return result;
}

export function getGuildInvestmentPolicy(guildId) {
  const row = db.prepare("SELECT default_risk_bps,max_risk_bps FROM guild_investment_policy WHERE guild_id=?").get(guildId);
  return row
    ? { defaultRiskBps: Number(row.default_risk_bps), maxRiskBps: Number(row.max_risk_bps) }
    : { defaultRiskBps: 500, maxRiskBps: 1000 };
}

export function setGuildInvestmentPolicy({ guildId, actorId, defaultRiskBps, maxRiskBps, now = Date.now() }) {
  if (!/^\d{5,25}$/.test(guildId ?? "") || !/^\d{5,25}$/.test(actorId ?? "")) throw new Error("Serveur ou administrateur Discord invalide.");
  if (!Number.isSafeInteger(defaultRiskBps) || !Number.isSafeInteger(maxRiskBps) || defaultRiskBps < 1 || maxRiskBps > 1000 || defaultRiskBps > maxRiskBps) {
    throw new Error("Risque invalide : défaut ≥ 1, maximum ≤ 1000 points de base, défaut ≤ maximum.");
  }
  db.prepare(`INSERT INTO guild_investment_policy(guild_id,default_risk_bps,max_risk_bps,updated_by,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET default_risk_bps=excluded.default_risk_bps,
    max_risk_bps=excluded.max_risk_bps,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(guildId, defaultRiskBps, maxRiskBps, actorId, now);
  return getGuildInvestmentPolicy(guildId);
}

export function createInvestment({ guildId, userId, principal: value, riskBps = null, now = Date.now(), seed = randomUUID() }) {
  const principal = amount(value, "Placement");
  if (!/^\d{5,25}$/.test(guildId ?? "") || !/^\d{5,25}$/.test(userId ?? "")) throw new Error("Serveur ou membre Discord invalide.");
  const riskPolicy = getGuildInvestmentPolicy(guildId);
  const selectedRisk = riskBps ?? riskPolicy.defaultRiskBps;
  if (!Number.isSafeInteger(selectedRisk) || selectedRisk < 1 || selectedRisk > riskPolicy.maxRiskBps) {
    throw new Error(`Risque maximum de ce serveur : ${riskPolicy.maxRiskBps} points de base.`);
  }
  const id = randomUUID();
  return transaction(() => {
    db.prepare(`INSERT INTO investments(id,guild_id,user_id,principal,current_value,risk_bps,seed,status,created_at,updated_at)
      VALUES(?,?,?, ?,0,?,?,'active',?,?)`).run(id, guildId, userId, principal, selectedRisk, seed, now, now);
    applyEconomyOperation({
      guildId,
      operationId: `investment-open:${id}`,
      reason: "investment_open",
      now,
      postings: [
        { accountType: "member", accountId: userId, delta: -principal },
        { accountType: "investment", accountId: id, delta: principal },
      ],
    });
    return db.prepare("SELECT id,guild_id,user_id,principal,current_value,risk_bps,status,created_at,updated_at FROM investments WHERE id=?").get(id);
  });
}

export function tickInvestment({ guildId, investmentId, tickKey, now = Date.now() }) {
  if (typeof tickKey !== "string" || !/^[a-zA-Z0-9:_-]{1,80}$/.test(tickKey)) throw new Error("Clé de période invalide.");
  return transaction(() => {
    const investment = db.prepare("SELECT * FROM investments WHERE guild_id=? AND id=? AND status='active'").get(guildId, investmentId);
    if (!investment) throw new Error("Placement actif introuvable.");
    const prior = db.prepare("SELECT * FROM investment_ticks WHERE investment_id=? AND tick_key=?").get(investmentId, tickKey);
    if (prior) return { ...prior, duplicate: true };
    const digest = createHash("sha256").update(`${investment.seed}:${tickKey}`).digest();
    const span = investment.risk_bps * 2 + 1;
    const returnBps = (digest.readUInt32BE(0) % span) - investment.risk_bps;
    const before = Number(investment.current_value);
    const delta = Math.trunc((before * returnBps) / 10_000);
    const after = Math.max(0, before + delta);
    const actualDelta = after - before;
    const seedHash = digest.toString("hex");
    applyEconomyOperation({
      guildId,
      operationId: `investment-tick:${investmentId}:${tickKey}`,
      reason: "investment_tick",
      now,
      allowUnbalanced: true,
      postings: [{ accountType: "investment", accountId: investmentId, delta: actualDelta }],
    });
    db.prepare(`INSERT INTO investment_ticks(investment_id,tick_key,seed_hash,return_bps,before_value,after_value,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(investmentId, tickKey, seedHash, returnBps, before, after, now);
    return { investmentId, tickKey, seedHash, returnBps, beforeValue: before, afterValue: after, duplicate: false };
  });
}

export function closeInvestment({ guildId, investmentId, userId, requestId, now = Date.now() }) {
  return transaction(() => {
    const investment = db.prepare("SELECT * FROM investments WHERE guild_id=? AND id=? AND user_id=? AND status='active'").get(guildId, investmentId, userId);
    if (!investment) throw new Error("Placement actif introuvable.");
    const payout = Number(investment.current_value);
    const result = applyEconomyOperation({
      guildId,
      operationId: `investment-close:${investmentId}:${requestId}`,
      reason: "investment_close",
      now,
      postings: [
        { accountType: "investment", accountId: investmentId, delta: -payout },
        { accountType: "member", accountId: userId, delta: payout },
      ],
    });
    if (result.applied) db.prepare("UPDATE investments SET status='closed',closed_at=?,updated_at=? WHERE guild_id=? AND id=? AND status='active'")
      .run(now, now, guildId, investmentId);
    return { payout, ...result };
  });
}

export function tickGuildInvestments({ guildId, tickKey, now = Date.now() }) {
  const active = db.prepare("SELECT id FROM investments WHERE guild_id=? AND status='active' ORDER BY id").all(guildId);
  const results = [];
  for (const investment of active) {
    results.push(tickInvestment({ guildId, investmentId: investment.id, tickKey, now }));
  }
  return { guildId, tickKey, checked: active.length, results };
}

export function listInvestments(guildId, userId) {
  return db.prepare("SELECT id,principal,current_value,risk_bps,status,created_at,updated_at,closed_at FROM investments WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50")
    .all(guildId, userId);
}
