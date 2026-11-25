import { parisDay } from "./collector.js";

/** Heure actuelle à Paris (0-23). */
export function parisHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour").value);
}

/** Le résumé tourne une fois par jour, à partir de l'heure choisie. */
export function shouldRunDigest(now, digestHour, lastRunDay) {
  return parisHour(now) >= digestHour && parisDay(now) !== lastRunDay;
}
