// FWU — base centrale partagée par les 5 bots (PostgreSQL sur le serveur distant).
//
// Quotas, sanctions, exemptions, whitelist de bots, configuration et journaux
// vivent ici : les 5 processus voient exactement les mêmes compteurs.
// L'économie et les autres modules historiques restent dans le SQLite local.
//
// Connexion : SHARED_DATABASE_URL (postgres://user:motdepasse@hote:5432/base).
// Aucun identifiant n'est écrit dans le code. Le pool se reconnecte tout seul ;
// tant que la base est injoignable, `sharedDbAvailable()` vaut false et les
// commandes de modération soumises à quota sont refusées (fail closed).
import pg from "pg";

const { Pool } = pg;

export class SharedDbUnavailableError extends Error {
  constructor(message = "Base centrale injoignable.") {
    super(message);
    this.name = "SharedDbUnavailableError";
    this.code = "SHARED_DB_UNAVAILABLE";
  }
}

// Codes réseau / serveur qui signifient « base injoignable », pas « requête fausse ».
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "EAI_AGAIN",
  "57P01", "57P02", "57P03", // admin_shutdown, crash_shutdown, cannot_connect_now
  "08000", "08003", "08006", "08001", "08004", // connection_exception family
  "53300", // too_many_connections
]);

export function isConnectionError(error) {
  if (!error) return false;
  if (error instanceof SharedDbUnavailableError) return true;
  if (CONNECTION_ERROR_CODES.has(error.code)) return true;
  const message = String(error.message ?? "");
  return /Connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED|Client has encountered a connection error/i.test(message);
}

let pool = null;
let initialized = false; // a central database was configured in this process (kept after close)
let available = false;
let lastError = null;
let reconnectTimer = null;
let reconnectDelayMs = 1_000;
const listeners = new Set();

function setAvailable(value, error = null) {
  const changed = available !== value;
  available = value;
  lastError = value ? null : (error?.code ?? error?.message ?? "inconnu");
  if (changed) for (const listener of listeners) { try { listener(value); } catch { /* listener errors never break the DB layer */ } }
}

/** Called with true/false when the central database becomes (un)available. */
export function onSharedDbAvailability(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sharedDbConfigured(env = process.env) {
  return Boolean(String(env.SHARED_DATABASE_URL ?? "").trim());
}

export function sharedDbAvailable() {
  return available;
}

/** True once initSharedDb() was called with a URL: logs are then worth buffering during outages. */
export function sharedDbInitialized() {
  return initialized;
}

export function sharedDbStatus() {
  return { configured: sharedDbConfigured(), available, lastError };
}

function buildPoolConfig(env) {
  const connectionString = String(env.SHARED_DATABASE_URL ?? "").trim();
  if (!connectionString) throw new SharedDbUnavailableError("SHARED_DATABASE_URL n'est pas configurée.");
  const sslMode = String(env.SHARED_DATABASE_SSL ?? "").trim().toLowerCase();
  const schema = String(env.SHARED_DATABASE_SCHEMA ?? "").trim();
  if (schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("SHARED_DATABASE_SCHEMA invalide.");
  return {
    connectionString,
    max: Math.min(20, Math.max(2, Number(env.SHARED_DATABASE_POOL_MAX) || 5)),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
    application_name: `fwu-${String(env.PND_BOT_PROFILE || "fwu").slice(0, 20)}`,
    ...(sslMode === "require" ? { ssl: { rejectUnauthorized: true } } : sslMode === "no-verify" ? { ssl: { rejectUnauthorized: false } } : {}),
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  };
}

function scheduleReconnect() {
  if (reconnectTimer || !pool) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await pool.query("SELECT 1");
      reconnectDelayMs = 1_000;
      setAvailable(true);
    } catch (error) {
      setAvailable(false, error);
      reconnectDelayMs = Math.min(60_000, reconnectDelayMs * 2);
      scheduleReconnect();
    }
  }, reconnectDelayMs);
  reconnectTimer.unref?.();
}

/** Open the pool (idempotent). Never throws on a network error: it retries in the background. */
export async function initSharedDb(env = process.env) {
  if (pool) return pool;
  pool = new Pool(buildPoolConfig(env));
  initialized = true;
  // An idle client losing its socket must not crash the process.
  pool.on("error", (error) => {
    setAvailable(false, error);
    scheduleReconnect();
  });
  try {
    await pool.query("SELECT 1");
    setAvailable(true);
  } catch (error) {
    setAvailable(false, error);
    scheduleReconnect();
  }
  return pool;
}

export async function closeSharedDb() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const current = pool;
  pool = null;
  setAvailable(false);
  if (current) await current.end().catch(() => {});
}

function wrapError(error) {
  if (isConnectionError(error)) {
    setAvailable(false, error);
    scheduleReconnect();
    return new SharedDbUnavailableError();
  }
  return error;
}

/** One query. Connection failures become SharedDbUnavailableError. */
export async function sharedQuery(text, params = []) {
  if (!pool) throw new SharedDbUnavailableError("Base centrale non initialisée.");
  try {
    const result = await pool.query(text, params);
    if (!available) setAvailable(true);
    return result;
  } catch (error) {
    throw wrapError(error);
  }
}

/** Run fn(client) inside BEGIN/COMMIT; ROLLBACK on any error. */
export async function sharedTransaction(fn) {
  if (!pool) throw new SharedDbUnavailableError("Base centrale non initialisée.");
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw wrapError(error);
  }
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    if (!available) setAvailable(true);
    return result;
  } catch (error) {
    broken = isConnectionError(error);
    await client.query("ROLLBACK").catch(() => { broken = true; });
    throw wrapError(error);
  } finally {
    client.release(broken ? true : undefined);
  }
}
