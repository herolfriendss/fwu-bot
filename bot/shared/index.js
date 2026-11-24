// FWU — démarrage de la couche partagée (base centrale distante) dans chaque bot.
import { initSharedDb, onSharedDbAvailability, sharedDbConfigured, sharedDbStatus } from "./db.js";
import { runSharedMigrations } from "./migrate.js";
import { startOutboxFlusher } from "./audit.js";

let started = false;

/**
 * Open the pool, apply migrations as soon as the database answers, start the
 * log outbox flusher. Never throws: without a database, quota-bound moderation
 * commands are refused and the bot keeps running everything else.
 */
export async function startSharedLayer({ record = () => {}, env = process.env } = {}) {
  if (started) return sharedDbStatus();
  started = true;
  if (!sharedDbConfigured(env)) {
    record("shared_db_not_configured");
    return sharedDbStatus();
  }
  let migrated = false;
  let running = null;
  const migrate = () => {
    if (migrated) return Promise.resolve();
    running ??= runSharedMigrations()
      .then((applied) => { migrated = true; if (applied.length) record("shared_db_migrated"); })
      .catch(() => record("shared_db_migration_error"))
      .finally(() => { running = null; });
    return running;
  };
  onSharedDbAvailability((up) => {
    record(up ? "shared_db_up" : "shared_db_down");
    if (up) void migrate();
  });
  await initSharedDb(env);
  startOutboxFlusher();
  if (sharedDbStatus().available) await migrate();
  else record("shared_db_down"); // injoignable dès le démarrage : signalé, reconnexion en arrière-plan
  return sharedDbStatus();
}

export { sharedDbStatus };
