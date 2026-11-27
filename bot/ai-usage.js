// Usage de l'IA : un compteur par mois et par type (chat, traduction, résumé, règlement),
// envoyé à l'owner en message privé le 1er du mois. Aucun contenu n'est gardé, seulement des nombres.
import { db } from "./database.js";

db.exec("CREATE TABLE IF NOT EXISTS ai_usage (month TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, kind))");
db.exec("CREATE TABLE IF NOT EXISTS ai_usage_reports (month TEXT PRIMARY KEY, sent_at INTEGER NOT NULL)");

export const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
export const previousMonthKey = (now = Date.now()) => { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return monthKey(d.getTime()); };
// Coût indicatif par appel (modèles légers), en euros : un ordre de grandeur, pas une facture.
export const ESTIMATED_COST_EUR = Object.freeze({ chat: 0.002, traduction: 0.001, resume: 0.003, reglement: 0.01 });

export function recordAiUsage(kind, now = Date.now()) {
  try { db.prepare("INSERT INTO ai_usage(month, kind, calls) VALUES (?,?,1) ON CONFLICT(month, kind) DO UPDATE SET calls = calls + 1").run(monthKey(now), String(kind).slice(0, 20)); } catch { /* jamais bloquant */ }
}

export function usageReport(month) {
  const rows = db.prepare("SELECT kind, calls FROM ai_usage WHERE month=? ORDER BY calls DESC").all(month);
  const total = rows.reduce((n, r) => n + r.calls, 0);
  const cost = rows.reduce((n, r) => n + r.calls * (ESTIMATED_COST_EUR[r.kind] ?? 0.002), 0);
  return { month, rows, total, cost: Math.round(cost * 100) / 100 };
}

/** Sends last month's report once (call daily from the main bot). */
export async function sendMonthlyAiReport(client, ownerId, now = Date.now()) {
  if (!ownerId || new Date(now).getUTCDate() !== 1) return false;
  const month = previousMonthKey(now);
  if (db.prepare("SELECT 1 FROM ai_usage_reports WHERE month=?").get(month)) return false;
  db.prepare("INSERT OR IGNORE INTO ai_usage_reports VALUES (?,?)").run(month, now);
  const report = usageReport(month);
  const owner = await client.users.fetch(ownerId).catch(() => null);
  if (!owner) return false;
  await owner.send({ content: `🤖 **Usage de l'IA en ${month}** : ${report.total} réponse(s)\n${report.rows.map((r) => `• ${r.kind} : ${r.calls}`).join("\n") || "• aucune"}\nCoût estimé : ~${report.cost.toFixed(2)} € (ordre de grandeur).`, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
