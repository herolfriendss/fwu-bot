import { db, transaction } from "./database.js";

const MAX_AMOUNT = 1_000_000_000_000;
const SNOWFLAKE = /^\d{5,25}$/;
const safeId = (value) => typeof value === "string" && value.length > 0 && value.length <= 180;

function validatePosting(posting) {
  if (!posting || !["member", "business", "investment"].includes(posting.accountType)) {
    throw new Error("Type de compte PND invalide.");
  }
  if (!safeId(posting.accountId) || !Number.isSafeInteger(posting.delta) || Math.abs(posting.delta) > MAX_AMOUNT) {
    throw new Error("Mouvement PND invalide.");
  }
}

function applyPosting(guildId, posting, reason, now) {
  const { accountType, accountId, delta } = posting;
  if (!delta) return;

  let update;
  let ledgerUserId;
  if (accountType === "member") {
    if (!SNOWFLAKE.test(accountId)) throw new Error("Identifiant membre Discord invalide.");
    db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, accountId);
    update = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance+? BETWEEN 0 AND ?")
      .run(delta, guildId, accountId, delta, MAX_AMOUNT);
    ledgerUserId = accountId;
  } else if (accountType === "business") {
    update = db.prepare("UPDATE businesses SET treasury=treasury+?,updated_at=? WHERE guild_id=? AND id=? AND treasury+? >= 0")
      .run(delta, now, guildId, accountId, delta);
    ledgerUserId = `business:${accountId}`;
  } else {
    update = db.prepare("UPDATE investments SET current_value=current_value+?,updated_at=? WHERE guild_id=? AND id=? AND current_value+? >= 0 AND status='active'")
      .run(delta, now, guildId, accountId, delta);
    ledgerUserId = `investment:${accountId}`;
  }
  if (!Number(update.changes)) throw new Error("Solde PND insuffisant ou compte introuvable.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, ledgerUserId, delta, reason.slice(0, 80), now);
}

/**
 * Applies a multi-account operation once. Ordinary transfers must balance to
 * zero; only trusted internal investment valuation code may set allowUnbalanced.
 * The returned duplicate marker makes interaction retries safe.
 */
export function applyEconomyOperation({ guildId, operationId, reason, postings, allowUnbalanced = false, now = Date.now() }) {
  if (!safeId(guildId) || !safeId(operationId) || !safeId(reason) || !Array.isArray(postings) || !postings.length || postings.length > 20) {
    throw new Error("Opération PND invalide.");
  }
  postings.forEach(validatePosting);
  const total = postings.reduce((sum, posting) => sum + posting.delta, 0);
  if (!allowUnbalanced && total !== 0) throw new Error("Une opération de transfert doit être équilibrée.");
  return transaction(() => {
    const inserted = db.prepare("INSERT OR IGNORE INTO economy_operations(guild_id,operation_id,reason,created_at) VALUES(?,?,?,?)")
      .run(guildId, operationId, reason.slice(0, 80), now);
    if (!Number(inserted.changes)) return { applied: false, duplicate: true };
    for (const posting of postings) applyPosting(guildId, posting, reason, now);
    return { applied: true, duplicate: false };
  });
}
