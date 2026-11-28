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
  assert.equal(autoUpdateDue({ now: at11, env: {}, status: { state: "done", at: Math.floor(new Date("2026-11-26T07:10:00Z").getTime() / 1000) } }), "2026-11-27", "rattrape l’heure si le bot redémarre après 8 h");
  assert.equal(autoUpdateDue({ now: at11, env: {}, status: { state: "done", at: Math.floor(at8.getTime() / 1000) } }), false, "ne relance pas après redémarrage si une mise à jour a déjà réussi aujourd’hui");
  assert.equal(autoUpdateDue({ now: at8, env: { FWU_AUTO_UPDATE: "off" } }), false);
  assert.equal(autoUpdateDue({ now: at8, env: {}, status: { state: "running", at: Math.floor(at8.getTime() / 1000) } }), false);
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T21:30:00Z"), env: { FWU_AUTO_UPDATE_HOUR: "22" } }), "2026-11-27");
  assert.equal(autoUpdateDue({ now: at8, env: { FWU_AUTO_UPDATE_HOUR: "invalid" } }), "2026-11-27", "une valeur invalide garde le défaut de 8 h");
  assert.equal(autoUpdateDue({ now: at8, env: {}, status: { state: "done", at: "invalid" } }), "2026-11-27", "un statut mal formé ne bloque pas le planificateur");
});

test("auto update: strict hour, DST-safe Paris time, bounded catch-up window", async () => {
  const { autoUpdateDue, parseAutoUpdateHour } = await import("./self-update.js");
  for (const bad of ["8abc", "24", "-1", "", " ", "7.5", "1e1"]) assert.equal(parseAutoUpdateHour(bad), 8, bad);
  assert.equal(parseAutoUpdateHour(undefined), 8);
  assert.equal(parseAutoUpdateHour(" 3 "), 3);
  assert.equal(parseAutoUpdateHour("0"), 0);
  // Summer time (UTC+2): 06:10 UTC is 08:10 in Paris; 05:59 UTC is still 07:59.
  assert.equal(autoUpdateDue({ now: new Date("2026-07-14T06:10:00Z"), env: {} }), "2026-07-14");
  assert.equal(autoUpdateDue({ now: new Date("2026-07-14T05:59:00Z"), env: {} }), false);
  // DST switch days (29 March / 25 October 2026) still trigger exactly at 08:xx local time.
  assert.equal(autoUpdateDue({ now: new Date("2026-03-29T06:05:00Z"), env: {} }), "2026-03-29");
  assert.equal(autoUpdateDue({ now: new Date("2026-10-25T07:05:00Z"), env: {} }), "2026-10-25");
  assert.equal(autoUpdateDue({ now: new Date("2026-10-25T06:05:00Z"), env: {} }), false, "07:05 heure d'hiver");
  // Bot restarted before 08:00: nothing yet. Restarted late in the evening: no general restart.
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T06:50:00Z"), env: {} }), false);
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T10:50:00Z"), env: {} }), "2026-11-27", "rattrapage jusqu'à 11 h 59");
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T11:00:00Z"), env: {} }), false, "plus de rattrapage à midi");
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T19:00:00Z"), env: {} }), false);
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T07:10:00Z"), env: { FWU_AUTO_UPDATE: " OFF " } }), false);
  // A failed update today is not retried in a loop.
  const at = Math.floor(new Date("2026-11-27T07:20:00Z").getTime() / 1000);
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T08:00:00Z"), env: {}, status: { state: "failed", at } }), false);
  // A stale "running" status (crashed script) no longer blocks.
  const old = Math.floor(new Date("2026-11-27T05:00:00Z").getTime() / 1000);
  assert.equal(autoUpdateDue({ now: new Date("2026-11-27T07:10:00Z"), env: {}, status: { state: "running", at: old } }), "2026-11-27");
});

test("auto update: one check per day survives restarts and never needs the script to exist twice", async () => {
  const { startAutoUpdate, readAutoUpdateDay } = await import("./self-update.js");
  const dataDir = mkdtempSync(join(tmpdir(), "fwu-maj-auto-"));
  const spawned = [];
  const spawnFn = (cmd, args) => { spawned.push(args); return { unref() {} }; };
  const events = [];
  // 11 h 50 à Paris : le contrôle immédiat au démarrage évite de manquer la fin de la fenêtre à midi.
  const now = () => new Date("2026-11-27T10:50:00Z");
  const first = startAutoUpdate({ spawnFn, record: (e) => events.push(e), env: {}, dir: dataDir, now, scriptExists: () => true, intervalMs: 3_600_000 });
  assert.equal(spawned.length, 1, "contrôle immédiat au démarrage dans la fenêtre de rattrapage");
  assert.equal(first.tick(), false, "pas deux fois dans le même processus");
  first.stop();
  assert.equal(readAutoUpdateDay(dataDir), "2026-11-27");
  // Simulated restart of SUCK ME (the update restarts it) the same morning.
  const second = startAutoUpdate({ spawnFn, record: (e) => events.push(e), env: {}, dir: dataDir, now, scriptExists: () => true, intervalMs: 3_600_000 });
  assert.equal(second.tick(), false, "pas de nouveau contrôle après redémarrage");
  second.stop();
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].includes("--auto"));
  assert.deepEqual(events, ["auto_update_check"]);
  // Corrupted day file is ignored, missing script is reported once and not retried all day.
  writeFileSync(join(dataDir, "auto-update-jour"), "garbage");
  assert.equal(readAutoUpdateDay(dataDir), null);
  const third = startAutoUpdate({ spawnFn, record: (e) => events.push(e), env: {}, dir: dataDir, now, scriptExists: () => false, intervalMs: 3_600_000 });
  assert.equal(third.tick(), false);
  assert.equal(third.tick(), false);
  third.stop();
  assert.deepEqual(events, ["auto_update_check", "auto_update_error"]);
  assert.equal(spawned.length, 1);
});

test("la mise à jour ne reçoit ni le profil ni les tokens du bot qui la lance", async () => {
  const m = await import("./self-update.js");
  const env = m.cleanUpdateEnv({ PATH: "/bin", PND_BOT_PROFILE: "suckme", DISCORD_TOKEN: "a", PND_SUCKME_TOKEN: "b", PND_GUARD_GUILD_IDS: "1", PND_OWNER_DISCORD_ID: "9", SITE_URL: "x" });
  assert.deepEqual(env, { PATH: "/bin", PND_OWNER_DISCORD_ID: "9", SITE_URL: "x" });
  let opts;
  m.launchUpdate((_c, _a, o) => { opts = o; return { unref() {} }; }, "/x.sh");
  assert.ok(opts.env && !("PND_BOT_PROFILE" in opts.env));
});

test("auto update refuses to launch when the daily marker cannot be persisted", async () => {
  const { startAutoUpdate } = await import("./self-update.js");
  const parent = mkdtempSync(join(tmpdir(), "fwu-maj-marker-"));
  const missingDir = join(parent, "missing");
  const spawned = [];
  const events = [];
  const updater = startAutoUpdate({
    spawnFn: (...args) => { spawned.push(args); return { unref() {} }; },
    record: (event) => events.push(event),
    env: {},
    dir: missingDir,
    now: () => new Date("2026-11-27T07:10:00Z"),
    scriptExists: () => true,
    intervalMs: 3_600_000,
  });
  assert.equal(updater.tick(), false);
  updater.stop();
  assert.equal(spawned.length, 0, "no update without a durable once-per-day marker");
  assert.deepEqual(events, ["auto_update_error"]);
});
