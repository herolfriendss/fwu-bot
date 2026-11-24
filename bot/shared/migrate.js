// FWU — migrations versionnées de la base centrale.
// Fichiers shared/migrations/NNN_nom.sql, appliqués dans l'ordre, une seule fois.
// Un verrou consultatif PostgreSQL empêche deux bots de migrer en même temps.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sharedTransaction } from "./db.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
const MIGRATION_LOCK_KEY = 4_242_001; // arbitrary, constant across bots

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({ version: Number(name.slice(0, 3)), name, sql: readFileSync(`${dir}${name}`, "utf8") }));
}

/** Apply pending migrations. Returns the names applied by this call. */
export async function runSharedMigrations(dir = MIGRATIONS_DIR) {
  const files = listMigrationFiles(dir);
  return sharedTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((row) => Number(row.version)));
    const applied = [];
    for (const file of files) {
      if (done.has(file.version)) continue;
      await client.query(file.sql);
      await client.query("INSERT INTO schema_migrations(version, name) VALUES ($1, $2)", [file.version, file.name]);
      applied.push(file.name);
    }
    return applied;
  });
}
