import { tickGuildInvestments } from "./business-investments.js";

const DAY_MS = 86_400_000;

/** One deterministic market valuation per UTC day and allowlisted source guild. */
export function runInvestmentMaintenance(client, allowedGuildIds, now = Date.now(), record = () => {}) {
  const allowed = new Set(Array.isArray(allowedGuildIds) ? allowedGuildIds : []);
  const tickKey = new Date(now).toISOString().slice(0, 10);
  const report = { guilds: 0, checked: 0, changed: 0, errors: 0, tickKey };
  for (const guild of client.guilds.cache.values()) {
    if (!allowed.has(guild.id)) continue;
    report.guilds++;
    try {
      const result = tickGuildInvestments({ guildId: guild.id, tickKey, now });
      report.checked += result.checked;
      report.changed += result.results.filter((item) => !item.duplicate).length;
    } catch {
      report.errors++;
      record("investment_daily_tick_error");
    }
  }
  if (report.changed) record("investment_daily_tick_complete");
  return report;
}

export function startInvestmentMaintenance(client, allowedGuildIds, record = () => {}, shouldRun = () => true) {
  const run = () => { if (shouldRun()) runInvestmentMaintenance(client, allowedGuildIds, Date.now(), record); };
  run();
  const timer = setInterval(run, Math.min(DAY_MS, 60 * 60_000));
  timer.unref?.();
  return timer;
}
