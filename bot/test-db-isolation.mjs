// Preloaded by `npm test`: every test process gets its own disposable SQLite
// file unless the test file sets HER_DB_PATH itself. Tests must never touch
// bot/data/economy.sqlite (the production database location).
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The production bot is started with --env-file=.env. When it launches the
// deployment test suite as a child process, that environment is inherited.
// Never let the suite treat production PostgreSQL as configured: safety checks
// such as loadRoleTiersStrict() would otherwise fail closed because tests do
// not initialize the production pool. Tests that need PostgreSQL must opt in
// explicitly with their disposable test database, never the production URL.
delete process.env.SHARED_DATABASE_URL;

if (!process.env.HER_DB_PATH || process.env.HER_DB_PATH_AUTO === "1") {
  const path = join(tmpdir(), `pnd-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.HER_DB_PATH = path;
  process.env.HER_DB_PATH_AUTO = "1";
  // The central-log outbox never goes to bot/data either.
  process.env.SHARED_LOG_OUTBOX_PATH ??= join(tmpdir(), `pnd-outbox-${process.pid}-${Date.now()}.jsonl`);
  process.on("exit", () => {
    try { rmSync(process.env.SHARED_LOG_OUTBOX_PATH, { force: true }); } catch { /* ignore */ }
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        rmSync(`${path}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  });
}
