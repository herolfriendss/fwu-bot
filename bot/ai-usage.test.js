import test from "node:test";
import assert from "node:assert/strict";
import { previousMonthKey, recordAiUsage, sendMonthlyAiReport, usageReport } from "./ai-usage.js";

test("AI usage counters and monthly report (once, on the 1st)", async () => {
  const nov = Date.UTC(2026, 10, 15);
  recordAiUsage("chat", nov); recordAiUsage("chat", nov); recordAiUsage("traduction", nov);
  const r = usageReport("2026-11");
  assert.equal(r.total, 3);
  assert.deepEqual({ ...r.rows[0] }, { kind: "chat", calls: 2 });
  assert.equal(previousMonthKey(Date.UTC(2026, 11, 1)), "2026-11");
  const sent = [];
  const client = { users: { fetch: async () => ({ send: async (p) => sent.push(p.content) }) } };
  assert.equal(await sendMonthlyAiReport(client, "1", Date.UTC(2026, 11, 2)), false, "pas le 1er");
  assert.equal(await sendMonthlyAiReport(client, "1", Date.UTC(2026, 11, 1, 10)), true);
  assert.equal(await sendMonthlyAiReport(client, "1", Date.UTC(2026, 11, 1, 11)), false, "une seule fois");
  assert.match(sent[0], /3 réponse/);
});
