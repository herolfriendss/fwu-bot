import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-maj-db-")), "db.sqlite");
const dir = mkdtempSync(join(tmpdir(), "fwu-maj-"));
process.env.FWU_UPDATE_DATA_DIR = dir;
process.env.FWU_AUTO_UPDATE_SCRIPT = join(dir, "fwu-auto-update.sh");
process.env.PND_OWNER_DISCORD_ID = "111111111111111111";
const m = await import("./self-update.js");

function interaction(userId, sub) {
  const replies = [];
  return { replies, user: { id: userId }, commandName: "maj", isChatInputCommand: () => true, options: { getSubcommand: () => sub }, reply: async (p) => { replies.push(p); } };
}

test("only the OWNER can start an update; launch is detached", async () => {
  const intruder = interaction("222222222222222222", "lancer");
  await m.handleSelfUpdateInteraction(intruder, { spawnFn: () => assert.fail("must not spawn") });
  assert.match(intruder.replies[0].content, /Seul l'OWNER/);
  const missing = interaction("111111111111111111", "lancer");
  await m.handleSelfUpdateInteraction(missing, { spawnFn: () => assert.fail("no script yet") });
  assert.match(missing.replies[0].content, /pas encore installée/);
  writeFileSync(process.env.FWU_AUTO_UPDATE_SCRIPT, "#!/bin/bash\n");
  const calls = [];
  const owner = interaction("111111111111111111", "lancer");
  await m.handleSelfUpdateInteraction(owner, { spawnFn: (...args) => { calls.push(args); return { unref() {} }; } });
  assert.equal(calls.length, 1);
  assert.match(calls[0][1][1], /setsid nohup/);
  assert.equal(calls[0][1][2], process.env.FWU_AUTO_UPDATE_SCRIPT);
});

test("refuses a second run while one is in progress, unless stale", () => {
  const now = Date.now();
  assert.equal(m.canStartUpdate({ state: "running", at: Math.floor(now / 1000) }, now), false);
  assert.equal(m.canStartUpdate({ state: "running", at: Math.floor(now / 1000) - 2 * 3600 }, now), true);
  assert.equal(m.canStartUpdate({ state: "done", at: 0 }, now), true);
});

test("log is masked and the result is announced once", async () => {
  writeFileSync(join(dir, "maj.log"), "ok\ntoken ghp_abcdefghijklmnopqrstuvwxyz123456 leaked\n");
  assert.doesNotMatch(m.readUpdateLog(dir), /ghp_/);
  writeFileSync(join(dir, "maj-status.json"), JSON.stringify({ state: "done", step: "Terminée", at: 1 }));
  const sent = [];
  const client = { users: { fetch: async () => ({ send: async (t) => sent.push(t) }) } };
  assert.equal(await m.announceUpdateResult(client, dir), true);
  assert.equal(await m.announceUpdateResult(client, dir), false);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, "maj-status.json"), "utf8")).announced, true);
});
