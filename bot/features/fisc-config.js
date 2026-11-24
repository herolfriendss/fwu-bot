// LE FISC — tax settings and the server treasury (no import from economy.js: safe to use from it).
import { db } from "../database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS fisc_config (
    guild_id TEXT PRIMARY KEY, transfer_rate INTEGER NOT NULL DEFAULT 0, wealth_threshold INTEGER NOT NULL DEFAULT 100000,
    wealth_rate INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS fisc_treasury (guild_id TEXT PRIMARY KEY, amount INTEGER NOT NULL DEFAULT 0 CHECK(amount >= 0));
`);

export function getFiscConfig(guildId) {
  const row = db.prepare("SELECT transfer_rate, wealth_threshold, wealth_rate FROM fisc_config WHERE guild_id=?").get(guildId);
  return { transferRate: row?.transfer_rate ?? 0, wealthThreshold: row?.wealth_threshold ?? 100_000, wealthRate: row?.wealth_rate ?? 0 };
}

export function saveFiscConfig(guildId, patch, actorId) {
  const next = { ...getFiscConfig(guildId), ...patch };
  next.transferRate = Math.min(20, Math.max(0, Math.trunc(next.transferRate)));
  next.wealthRate = Math.min(10, Math.max(0, Math.trunc(next.wealthRate)));
  next.wealthThreshold = Math.min(1_000_000_000, Math.max(1000, Math.trunc(next.wealthThreshold)));
  db.prepare(`INSERT INTO fisc_config(guild_id,transfer_rate,wealth_threshold,wealth_rate,updated_by,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET transfer_rate=excluded.transfer_rate, wealth_threshold=excluded.wealth_threshold,
    wealth_rate=excluded.wealth_rate, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(guildId, next.transferRate, next.wealthThreshold, next.wealthRate, actorId ?? null, Date.now());
  return next;
}

/** Tax kept on a transfer (rounded down; 0 when no rate is set). */
export function transferTax(guildId, amount) {
  return Math.floor((amount * getFiscConfig(guildId).transferRate) / 100);
}

export function treasury(guildId) {
  return Number(db.prepare("SELECT amount FROM fisc_treasury WHERE guild_id=?").get(guildId)?.amount ?? 0);
}

/** Must run inside the caller's transaction when combined with wallet changes. */
export function changeTreasury(guildId, delta) {
  db.prepare("INSERT OR IGNORE INTO fisc_treasury(guild_id,amount) VALUES(?,0)").run(guildId);
  const result = db.prepare("UPDATE fisc_treasury SET amount=amount+? WHERE guild_id=? AND amount+?>=0").run(delta, guildId, delta);
  if (!Number(result.changes)) throw new Error("La caisse du serveur est insuffisante.");
  return treasury(guildId);
}
