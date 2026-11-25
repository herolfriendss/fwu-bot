// FWU — démarrage de la couche partagée (base centrale distante) dans chaque bot.
import { initSharedDb, onSharedDbAvailability, sharedDbConfigured, sharedDbStatus } from "./db.js";
import { runSharedMigrations } from "./migrate.js";
import { startOutboxFlusher } from "./audit.js";

let started = false;
let downSince = null;

export const SHARED_DB_DOWN_GRACE_MS = 2 * 60_000;
const BLOCKED = "`/tempmute`, `/warn`, `+ban`, `+kick`, `;mv`… sont refusés à tout le monde sauf l'owner";

/** Texte d'alerte (Logs Hub + MP owner) pour chaque changement d'état de la base centrale. */
export const SHARED_DB_ALERTS = Object.freeze({
  not_configured: {
    title: "🔴 Base centrale non installée",
    description: `${BLOCKED}.\nSur le VPS : \`sudo bash ~/her-v5-production/deploy/oracle/install-shared-db.sh ~/her-v5-production/bot/.env\`, puis \`pm2 restart her-v5-bot\`.`,
    color: 0xef4444,
  },
  down: {
    title: "🔴 Base centrale injoignable",
    description: `Depuis plus de 2 min. ${BLOCKED}.\nSur le VPS : \`sudo systemctl status postgresql\`. Les bots reprennent seuls dès qu'elle revient.`,
    color: 0xef4444,
  },
  up: {
    title: "🟢 Base centrale revenue",
    description: "Les commandes de modération à quota remarchent.",
    color: 0x22c55e,
  },
});

/** Ligne de /sysp diagnostic bots. */
export function formatSharedDbLine(status = sharedDbStatus(), since = downSince) {
  if (!status?.configured) return `🔴 Base centrale : **non installée** — ${BLOCKED}.`;
  if (status.available) return "🟢 Base centrale : joignable.";
  return `🔴 Base centrale : **injoignable**${since ? ` depuis <t:${Math.floor(since / 1000)}:R>` : ""} — ${BLOCKED}.`;
}

/**
 * Décide quelles alertes envoyer. Pur : `state` garde { alertedDown, timer }.
 * Une coupure de moins de 2 min ne prévient personne (redémarrage de PostgreSQL).
 */
export function createSharedDbAlerter({ notify, graceMs = SHARED_DB_DOWN_GRACE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let alertedDown = false;
  let timer = null;
  return {
    notConfigured() { void Promise.resolve(notify("not_configured")).catch(() => {}); },
    change(up) {
      if (up) {
        if (timer) { clearTimer(timer); timer = null; }
        if (alertedDown) { alertedDown = false; void Promise.resolve(notify("up")).catch(() => {}); }
        return;
      }
      if (timer || alertedDown) return;
      timer = setTimer(() => { timer = null; alertedDown = true; void Promise.resolve(notify("down")).catch(() => {}); }, graceMs);
      timer?.unref?.();
    },
  };
}

/**
 * Open the pool, apply migrations as soon as the database answers, start the
 * log outbox flusher. Never throws: without a database, quota-bound moderation
 * commands are refused and the bot keeps running everything else.
 */
export async function startSharedLayer({ record = () => {}, env = process.env, notify = null } = {}) {
  if (started) return sharedDbStatus();
  started = true;
  const alerter = notify ? createSharedDbAlerter({ notify }) : null;
  if (!sharedDbConfigured(env)) {
    record("shared_db_not_configured");
    alerter?.notConfigured();
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
    downSince = up ? null : (downSince ?? Date.now());
    alerter?.change(up);
    if (up) void migrate();
  });
  await initSharedDb(env);
  startOutboxFlusher();
  if (sharedDbStatus().available) await migrate();
  else {
    record("shared_db_down"); // injoignable dès le démarrage : signalé, reconnexion en arrière-plan
    downSince ??= Date.now();
    alerter?.change(false);
  }
  return sharedDbStatus();
}

export { sharedDbStatus };
