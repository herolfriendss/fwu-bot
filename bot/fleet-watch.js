// Fleet watch: tells the staff, in Discord, when one of the bots goes down, waits for its
// Discord connection budget (bot/session-budget.js), stops for good (bot/gateway-watchdog.js)
// or comes back. Complements:
//   • relay-watch.js (only GUARD / SUCK ME, from the point of view of the bot covering them);
//   • the Supabase pg_cron webhook (202611270002_bot_outage_alerts.sql), which still alerts
//     when every bot and the site are down.
// The main bot watches all the others; SUCK ME watches the main bot (no single point of failure).
// Sources are the shared SQLite tables only (leases, gateway failures, gateway waits): no
// Discord call, no secret, works for the 6 current profiles and the future ones.

export const FLEET_STATES = Object.freeze(["online", "down", "waiting", "stopped", "absent"]);

/**
 * Pure state of one profile.
 * lease: { live } | null (a cleanly stopped bot deletes its lease row)
 * failure: { stopped } | null · wait: { until, reason } | null
 * startedRecently: the profile logged in on this VPS in the last 24 h (bot_gateway_starts).
 * A profile with neither a lease nor a recent start was never run here → "absent", no alert
 * (e.g. Invest + without token, a future bot not installed yet).
 */
export function profileState({ lease, failure, wait, startedRecently = false, now = Date.now() }) {
  if (lease?.live) return "online";
  if (failure?.stopped) return "stopped";
  if (wait && Number(wait.until) > now) return "waiting";
  if (!lease && !startedRecently) return "absent";
  return "down";
}

/**
 * Debounced transitions. A state must hold for `stableTicks` checks in a row before it is
 * reported, so a normal restart (20–40 s) raises nothing. The first stable state of each
 * profile is only remembered (no alert at the main bot's own start-up), except a bot that is
 * already stopped for good or waiting: that is worth telling at once.
 */
export function createFleetWatcher({ stableTicks = 3 } = {}) {
  const known = new Map();
  const pending = new Map();
  return {
    update(states) {
      const changes = [];
      for (const [profile, state] of Object.entries(states)) {
        const current = known.get(profile);
        if (current === state) { pending.delete(profile); continue; }
        const streak = pending.get(profile);
        const count = streak?.state === state ? streak.count + 1 : 1;
        if (count < stableTicks) { pending.set(profile, { state, count }); continue; }
        pending.delete(profile);
        known.set(profile, state);
        if (current === undefined) {
          if (state === "stopped" || state === "waiting") changes.push({ profile, from: null, to: state });
          continue;
        }
        if (state === "absent") continue;
        if (state === "online" && current === "absent") continue;
        changes.push({ profile, from: current, to: state });
      }
      return changes;
    },
    get states() { return Object.fromEntries(known); },
  };
}

/** Embed text for one change. Never mentions the product name (Discord identity rule). */
export function describeFleetChange({ to, from }, label, { pm2Name } = {}) {
  const restart = pm2Name ? ` Après correction : \`pm2 restart ${pm2Name}\` (une seule fois).` : "";
  switch (to) {
    case "down":
      return { title: `🔴 ${label} hors ligne`, description: `${label} ne répond plus depuis plus d'une minute. Le bot principal reprend ses tâches automatiques ; ses commandes sont indisponibles.`, color: 0xef4444, owner: false };
    case "waiting":
      return { title: `⏳ ${label} en attente de connexion`, description: `${label} attend avant de se connecter à Discord (trop de redémarrages récents ou connexions du jour presque épuisées). Il repartira tout seul : ne pas le relancer à la main, chaque relance consomme une connexion.`, color: 0xf59e0b, owner: false };
    case "stopped":
      return { title: `⛔ ${label} arrêté définitivement`, description: `${label} n'a pas réussi à se connecter à Discord après plusieurs essais et s'est arrêté pour ne pas boucler. Causes fréquentes : token réinitialisé, intents désactivés dans le portail Discord.${restart}`, color: 0x991b1b, owner: true };
    case "online":
      return { title: `✅ ${label} de retour`, description: `${label} est de nouveau connecté${from === "stopped" ? " après un arrêt définitif" : ""}.`, color: 0x22c55e, owner: from === "stopped" };
    default:
      return null;
  }
}

/** Profiles watched by this process: the main bot watches every other one, SUCK ME watches the main bot. */
export function watchedProfiles(selfProfile, allProfiles) {
  if (selfProfile === "fwu") return allProfiles.filter((id) => id !== "fwu");
  if (selfProfile === "suckme") return ["fwu"];
  return [];
}
