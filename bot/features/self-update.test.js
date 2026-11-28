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

function interaction(userId, sub, version = null) {
  const replies = [];
  return { replies, user: { id: userId }, commandName: "maj", isChatInputCommand: () => true, options: { getSubcommand: () => sub, getString: () => version }, reply: async (p) => { replies.push(p); } };
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

test("/maj lancer version : seule une version numérotée est transmise au script", async () => {
  writeFileSync(process.env.FWU_AUTO_UPDATE_SCRIPT, "#!/bin/bash\n");
  writeFileSync(join(dir, "maj-status.json"), JSON.stringify({ state: "done", step: "x", at: 1 }));
  assert.equal(m.parseVersionTag("1.2.3"), "v1.2.3");
  assert.equal(m.parseVersionTag("v10.0.1"), "v10.0.1");
  for (const bad of ["main", "fwu-quotas-prefixes", "v1.2", "v1.2.3; rm -rf /", "$(id)"]) assert.equal(m.parseVersionTag(bad), null, bad);
  const calls = [];
  const spawnFn = (...args) => { calls.push(args); return { unref() {} }; };
  const bad = interaction("111111111111111111", "lancer", "ma-branche");
  await m.handleSelfUpdateInteraction(bad, { spawnFn });
  assert.equal(calls.length, 0);
  assert.match(bad.replies[0].content, /Version illisible/);
  const ok = interaction("111111111111111111", "lancer", "1.4.0");
  await m.handleSelfUpdateInteraction(ok, { spawnFn });
  assert.equal(calls[0][1].at(-1), "v1.4.0", "la version passe en argument séparé, jamais dans le texte de la commande");
  assert.doesNotMatch(calls[0][1][1], /1\.4\.0/);
  writeFileSync(join(dir, "version-installee"), "v1.3.0\n");
  const etat = interaction("111111111111111111", "etat");
  await m.handleSelfUpdateInteraction(etat, { spawnFn });
  assert.match(etat.replies[0].content, /Version installée : \*\*v1\.3\.0\*\*/);
});

test("V2: automatic update runs once a night at the chosen Paris hour, never while an update runs, and can be turned off", async () => {
  const { autoUpdateDue } = await import("./self-update.js");
  const at8 = new Date("2026-11-27T07:10:00Z"); // 8 h 10 à Paris (UTC+1)
  assert.equal(autoUpdateDue({ now: at8, env: {} }), "2026-11-27");
  assert.equal(autoUpdateDue({ now: at8, env: {}, lastRunDay: "2026-11-27" }), false, "une fois par jour dans le même processus");
  const at11 = new Date("2026-11-27T10:00:00Z");
  assert.equal(autoUpdateDue({ now: at11, env: {}, status: { state: "done", at: Math.floor(at8.getTime() / 1000) } }), false, "ne relance pas après une mise à jour déjà terminée ce jour-là");
  assert.equal(autoUpdateDue({ now: at11, env: {}, status: { state: "done", at: Math.floor(new Date("2026-11-26T07:10:00Z").getTime() / 1000) } }), "2026-11-27", "rattrape l’heure si le bot redémarre après 8 h");
  assert.equal(autoUpdateDue({ now: at8, env: { FWU_AUTO_UPDATE: "off" } }), false);
  assert.equal(autoUpdateDue({ now: at8, env: {}, status: { state: "running", at: Math.floor(at8.getTime() / 1000) } }), false);
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T21:30:00Z"), env: { FWU_AUTO_UPDATE_HOUR: "22" } }), "2026-11-27");
});

test("la mise à jour ne reçoit ni le profil ni les tokens du bot qui la lance", async () => {
  const m = await import("./self-update.js");
  const env = m.cleanUpdateEnv({ PATH: "/bin", PND_BOT_PROFILE: "suckme", DISCORD_TOKEN: "a", PND_SUCKME_TOKEN: "b", PND_GUARD_GUILD_IDS: "1", PND_OWNER_DISCORD_ID: "9", SITE_URL: "x" });
  assert.deepEqual(env, { PATH: "/bin", PND_OWNER_DISCORD_ID: "9", SITE_URL: "x" });
  let opts;
  m.launchUpdate((_c, _a, o) => { opts = o; return { unref() {} }; }, "/x.sh");
  assert.ok(opts.env && !("PND_BOT_PROFILE" in opts.env));
});
