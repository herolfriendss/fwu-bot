// GARDE (SUCK ME) : outils quotidiens des SYS+. Partie pure : barème, résumés.

/** Suggested next sanction from the member's recent cases (the SYS+ still decides). */
export const BAREME = Object.freeze([
  { action: "Avertissement", detail: "/warn" },
  { action: "Mute 1 h", detail: "/tempmute durée 1h" },
  { action: "Mute 24 h", detail: "/tempmute durée 24h" },
  { action: "Bannissement temporaire 7 jours", detail: "/tempban 7j" },
  { action: "Bannissement définitif", detail: "/ban (avec preuve)" },
]);
const COUNTED = new Set(["warn", "mute", "tempmute", "timeout", "kick", "tempban", "ban"]);
export function nextSanction(cases, { now = Date.now(), windowDays = 90 } = {}) {
  const recent = cases.filter((c) => COUNTED.has(String(c.action).toLowerCase()) && now - Number(c.created_at) <= windowDays * 86_400_000);
  const step = Math.min(recent.length, BAREME.length - 1);
  return { count: recent.length, ...BAREME[step] };
}

export function countBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) { const k = keyFn(row); out.set(k, (out.get(k) ?? 0) + 1); }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

export function formatDuration(ms) {
  const minutes = Math.round(Number(ms) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Appel : vote result needs at least 2 votes and a strict majority. */
export function appealOutcome(pour, contre) {
  if (pour + contre < 2) return "quorum";
  return pour > contre ? "pour" : "contre";
}

/** Next Sunday 20:00 (Paris ≈ UTC+1 in winter; small drift accepted) after `now`, in ms. */
export function nextWeeklyReport(now = Date.now(), { weekday = 0, hourUtc = 19 } = {}) {
  const d = new Date(now);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0));
  let add = (weekday - d.getUTCDay() + 7) % 7;
  if (add === 0 && target.getTime() <= now) add = 7;
  return target.getTime() + add * 86_400_000;
}
