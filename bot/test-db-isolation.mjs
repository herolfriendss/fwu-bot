// Preloaded by `npm test`: every test process gets its own disposable SQLite
// file unless the test file sets HER_DB_PATH itself. Tests must never touch
// bot/data/economy.sqlite (the production database location).
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.HER_DB_PATH || process.env.HER_DB_PATH_AUTO === "1") {
  const path = join(tmpdir(), `pnd-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.HER_DB_PATH = path;
  process.env.HER_DB_PATH_AUTO = "1";
  process.on("exit", () => {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        rmSync(`${path}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  });
}
