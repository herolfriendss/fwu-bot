import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-malus-eco-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
await import("./commands.js");
const { cibleRewardAllowed, handleCibleMessage, handleRansomMessage } = await import("./economy-malus.js");
const { grantPnd, pndBalance } = await import("../../economy.js");
const { db } = await import("../../database.js");
const add = (member, kind, by = "sys", data = null) => db.prepare("INSERT OR REPLACE INTO malus_active VALUES ('g',?,?,?,0,?,?)").run(member, kind, by, Date.now() + 60_000, data);

test("taxe, rançon and cible move PND as announced", async (context) => {
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  add("taxed", "taxe");
  grantPnd("g", "taxed", 100, "daily");
  assert.equal(pndBalance("g", "taxed").balance, 70);
  assert.equal(pndBalance("g", "sys").balance, 30, "30 % au SYS+");
  grantPnd("g", "taxed", -10, "achat");
  assert.equal(pndBalance("g", "sys").balance, 30, "pas de taxe sur une dépense");

  add("hostage", "rancon", "sys", JSON.stringify({ amount: 50 }));
  let deleted = false;
  const sent = [];
  const msg = { guild: { id: "g" }, author: { id: "hostage" }, delete: async () => { deleted = true; }, channel: { send: async (p) => sent.push(p) } };
  assert.equal(await handleRansomMessage(msg), true);
  assert.equal(deleted, true);
  assert.equal(await handleRansomMessage({ ...msg, author: { id: "free" } }), false);

  add("target", "cible");
  const users = new Map([["target", { id: "target", bot: false }]]);
  users.filter = (fn) => { const m = new Map([...users].filter(([, u]) => fn(u))); return m; };
  const reactions = [];
  const mention = { guild: { id: "g" }, author: { id: "hunter" }, mentions: { users }, react: async (e) => reactions.push(e) };
  assert.equal(await handleCibleMessage(mention, { now: 1_000_000 }), true);
  assert.equal(pndBalance("g", "hunter").balance, 25);
  assert.equal(await handleCibleMessage(mention, { now: 1_010_000 }), false, "délai de 30 s");
  assert.equal(cibleRewardAllowed({ count: 10, last: 0 }, 1e12), false, "10 gains au plus");
});
