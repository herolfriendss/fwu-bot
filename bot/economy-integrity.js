import { db } from "./database.js";

/**
 * Read-only reconciliation. It never repairs or mutates financial records;
 * discrepancies are returned for a human operator to review.
 */
export function reconcileEconomyGuild(guildId) {
  if (typeof guildId !== "string" || !/^\d{5,25}$/.test(guildId)) throw new Error("Identifiant de serveur invalide.");

  const issues = [];
  const walletRows = db.prepare("SELECT user_id,balance FROM wallets WHERE guild_id=? ORDER BY user_id").all(guildId);
  const walletLedger = db.prepare("SELECT user_id,COALESCE(SUM(delta),0) AS total FROM economy_ledger WHERE guild_id=? AND user_id NOT LIKE 'business:%' AND user_id NOT LIKE 'investment:%' GROUP BY user_id")
    .all(guildId);
  const walletTotals = new Map(walletLedger.map((row) => [row.user_id, Number(row.total)]));
  for (const wallet of walletRows) {
    const expected = walletTotals.get(wallet.user_id) ?? 0;
    if (Number(wallet.balance) !== expected) {
      issues.push({ accountType: "member", accountId: wallet.user_id, stored: Number(wallet.balance), ledger: expected });
    }
    walletTotals.delete(wallet.user_id);
  }
  for (const [userId, expected] of walletTotals) {
    issues.push({ accountType: "member_missing_wallet", accountId: userId, stored: null, ledger: expected });
  }

  const businesses = db.prepare("SELECT id,treasury FROM businesses WHERE guild_id=? ORDER BY id").all(guildId);
  const businessLedger = db.prepare("SELECT user_id,COALESCE(SUM(delta),0) AS total FROM economy_ledger WHERE guild_id=? AND user_id LIKE 'business:%' GROUP BY user_id")
    .all(guildId);
  const businessTotals = new Map(businessLedger.map((row) => [row.user_id.slice("business:".length), Number(row.total)]));
  for (const business of businesses) {
    const expected = businessTotals.get(business.id) ?? 0;
    if (Number(business.treasury) !== expected) {
      issues.push({ accountType: "business", accountId: business.id, stored: Number(business.treasury), ledger: expected });
    }
    businessTotals.delete(business.id);
  }
  for (const [businessId, expected] of businessTotals) {
    issues.push({ accountType: "business_missing", accountId: businessId, stored: null, ledger: expected });
  }

  const investments = db.prepare("SELECT id,current_value FROM investments WHERE guild_id=? ORDER BY id").all(guildId);
  const investmentLedger = db.prepare("SELECT user_id,COALESCE(SUM(delta),0) AS total FROM economy_ledger WHERE guild_id=? AND user_id LIKE 'investment:%' GROUP BY user_id")
    .all(guildId);
  const investmentTotals = new Map(investmentLedger.map((row) => [row.user_id.slice("investment:".length), Number(row.total)]));
  for (const investment of investments) {
    const expected = investmentTotals.get(investment.id) ?? 0;
    if (Number(investment.current_value) !== expected) {
      issues.push({ accountType: "investment", accountId: investment.id, stored: Number(investment.current_value), ledger: expected });
    }
    investmentTotals.delete(investment.id);
  }
  for (const [investmentId, expected] of investmentTotals) {
    issues.push({ accountType: "investment_missing", accountId: investmentId, stored: null, ledger: expected });
  }

  return Object.freeze({ guildId, ok: issues.length === 0, checkedAt: Date.now(), issues: Object.freeze(issues) });
}
