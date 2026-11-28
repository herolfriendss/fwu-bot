import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-log-events-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");

const events = await import("./log-events.js");
const config = await import("./logs-config.js");
const { db } = await import("./database.js");
after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD = { id: "1562643485981544559", name: "Principal" };

test("a typed event is validated: category, action and severity are required", () => {
  assert.throws(() => events.normalizeLogEvent({ action: "ban", severity: "info" }), /catégorie/i);
  assert.throws(() => events.normalizeLogEvent({ category: "moderation", severity: "info" }), /action/i);
  assert.throws(() => events.normalizeLogEvent({ category: "moderation", action: "ban", severity: "grave" }), /gravité/i);
  assert.throws(() => events.normalizeLogEvent({ category: "nope", action: "ban", severity: "info" }), /catégorie/i);
  const ok = events.normalizeLogEvent({ category: "moderation", action: "ban", severity: "warning", actorId: "200000000000000002", targetId: "300000000000000003" });
  assert.equal(ok.category, "moderation");
});

test("the unified embed shows actor, action, target, case and link with bot and severity colour", () => {
  const embed = events.buildLogEmbed({ category: "moderation", action: "ban", severity: "critical", actorId: "200000000000000002", targetId: "300000000000000003", caseNumber: 7, link: "https://discord.com/channels/1/2/3", details: "Raison : spam", bot: "guard" });
  const names = embed.fields.map((f) => f.name);
  for (const name of ["Acteur", "Action", "Cible", "Dossier", "Lien"]) assert.ok(names.includes(name), name);
  assert.match(JSON.stringify(embed), /#7/);
  assert.equal(embed.color, events.severityColor("guard", "critical"));
  assert.notEqual(events.severityColor("guard", "info"), events.severityColor("guard", "critical"));
  assert.doesNotMatch(JSON.stringify(embed), /FWU/);
});

test("sanctions and sensitive actions get a case number, readable with getCase", async () => {
  const sent = [];
  const send = async (guild, settings, embed, fallback, components, users, options) => { sent.push({ embed, options }); return true; };
  const first = await events.logEvent(GUILD, null, { category: "moderation", action: "ban", severity: "warning", actorId: "200000000000000002", targetId: "300000000000000003", reason: "spam" }, { send });
  const second = await events.logEvent(GUILD, null, { category: "moderation", action: "kick", severity: "warning", actorId: "200000000000000002", targetId: "300000000000000004" }, { send });
  assert.equal(second.caseNumber, first.caseNumber + 1);
  assert.equal(sent[0].options.category, "moderation");
  const record = events.getCase(GUILD.id, first.caseNumber);
  assert.equal(record.action, "ban");
  assert.equal(record.reason, "spam");
  assert.equal(events.getCase("999999999999999999", first.caseNumber), null, "cases are isolated per guild");
  const info = await events.logEvent(GUILD, null, { category: "voice", action: "voice_join", severity: "info", targetId: "300000000000000003" }, { send });
  assert.equal(info.caseNumber, null, "plain events have no case");
});

test("duplicates within the window are dropped", async () => {
  let count = 0;
  const send = async () => { count += 1; return true; };
  const event = { category: "security", action: "token_leak", severity: "warning", targetId: "300000000000000009", details: "même texte" };
  await events.logEvent(GUILD, null, event, { send, now: 1_000_000 });
  const dup = await events.logEvent(GUILD, null, event, { send, now: 1_010_000 });
  assert.equal(dup.duplicate, true);
  assert.equal(count, 1);
  await events.logEvent(GUILD, null, event, { send, now: 1_200_000 });
  assert.equal(count, 2);
});

test("grave events go to the alert channel and ping the on-call staff role", async () => {
  config.setAlertRoleId("777777777777777777");
  const sent = [];
  const send = async (guild, settings, embed, fallback, components, users, options) => { sent.push(options); return true; };
  await events.logEvent(GUILD, null, { category: "security", action: "raid", severity: "critical", details: "12 arrivées/10 s" }, { send });
  assert.equal(sent[0].category, "alerts");
  assert.deepEqual(sent[0].mentionRoleIds, ["777777777777777777"]);
  await events.logEvent(GUILD, null, { category: "permissions", action: "blr_grant_attempt", severity: "info", targetId: "300000000000000003" }, { send });
  assert.equal(sent[1].category, "alerts", "alert actions are always alerts");
});

test("search by member, action and period, and member timeline", async () => {
  const send = async () => true;
  const t0 = 5_000_000_000;
  await events.logEvent(GUILD, null, { category: "moderation", action: "warn", severity: "notice", targetId: "300000000000000077", actorId: "200000000000000002" }, { send, now: t0 });
  await events.logEvent(GUILD, null, { category: "moderation", action: "tempmute", severity: "warning", targetId: "300000000000000077", actorId: "200000000000000002" }, { send, now: t0 + 1000 });
  await events.logEvent(GUILD, null, { category: "voice", action: "voice_join", severity: "info", targetId: "300000000000000077" }, { send, now: t0 + 2000 });
  assert.equal(events.searchLogs({ guildId: GUILD.id, memberId: "300000000000000077" }).length, 3);
  assert.equal(events.searchLogs({ guildId: GUILD.id, memberId: "300000000000000077", action: "warn" }).length, 1);
  assert.equal(events.searchLogs({ guildId: GUILD.id, memberId: "300000000000000077", since: t0 + 500 }).length, 2);
  const timeline = events.memberTimeline(GUILD.id, "300000000000000077");
  assert.deepEqual(timeline.map((row) => row.action), ["voice_join", "tempmute", "warn"]);
  assert.equal(events.searchLogs({ guildId: "1", memberId: "300000000000000077" }).length, 0);
});

test("untyped legacy logs are archived too, so a log deleted in Discord stays in the database", () => {
  events.archiveRawLog(GUILD.id, "members", { title: "👋 Arrivée d'un membre", description: "<@300000000000000055>" });
  const rows = events.searchLogs({ guildId: GUILD.id, memberId: "300000000000000055" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "members");
});

test("retention prunes old copies and the summary counts by category and severity", async () => {
  const send = async () => true;
  const now = 9_000_000_000_000;
  await events.logEvent(GUILD, null, { category: "games", action: "old", severity: "info" }, { send, now: now - 400 * 86_400_000 });
  const removed = events.pruneLogArchive(now, 180);
  assert.ok(removed >= 1);
  await events.logEvent(GUILD, null, { category: "moderation", action: "warn", severity: "notice", targetId: "300000000000000066" }, { send, now: now - 1000 });
  const summary = events.buildLogSummary(GUILD.id, now - 86_400_000, now);
  assert.match(summary.description, /moderation|Modération/i);
  assert.ok(summary.fields.length >= 1);
});

test("community digest includes daily activity and sanction counts", async () => {
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_daily (
    guild_id TEXT NOT NULL, day_key TEXT NOT NULL, metric TEXT NOT NULL,
    metric_value INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id, day_key, metric)
  )`);
  const now = Date.UTC(2026, 10, 28, 12);
  const day = new Date(now).toISOString().slice(0, 10);
  const insert = db.prepare("INSERT OR REPLACE INTO analytics_daily(guild_id,day_key,metric,metric_value,updated_at) VALUES(?,?,?,?,?)");
  insert.run(GUILD.id, day, "messages", 123, now);
  insert.run(GUILD.id, day, "joins", 4, now);
  insert.run(GUILD.id, day, "leaves", 2, now);
  const send = async () => true;
  await events.logEvent(GUILD, null, { category: "moderation", action: "ban", severity: "critical", targetId: "300000000000000088" }, { send, now });
  const summary = events.buildLogSummary(GUILD.id, now - 60_000, now + 60_000);
  const fields = Object.fromEntries(summary.fields.map((field) => [field.name, field.value]));
  assert.equal(fields.Messages, "123");
  assert.equal(fields.Arrivées, "4");
  assert.equal(fields.Départs, "2");
  assert.equal(fields.Sanctions, "1");
});

test("scheduled digest retries only failed sources without duplicating successful deliveries", async () => {
  config.setLogSummaryFrequency("daily");
  config.markSummarySent(1_000);
  db.exec("DELETE FROM log_summary_deliveries");
  const now = 10 * 86_400_000;
  const secondGuild = { id: "1562643485981544560", name: "Second" };
  const client = { guilds: { cache: new Map([[GUILD.id, GUILD], [secondGuild.id, secondGuild]]) } };
  const records = [];
  const firstAttempts = [];
  const first = events.startLogMaintenance({
    client, sources: () => [GUILD.id, secondGuild.id], intervalMs: 60_000, now: () => now,
    record: (code) => records.push(code),
    send: async (guild) => {
      firstAttempts.push(guild.id);
      if (guild.id === GUILD.id) throw new Error("temporary Discord delivery failure");
      return true;
    },
  });
  await first.tick();
  first.stop();
  assert.deepEqual(firstAttempts, [GUILD.id, secondGuild.id]);
  assert.equal(config.lastSummaryAt(), 1_000, "global checkpoint stays behind while one source failed");
  assert.equal(config.lastSummaryAt(GUILD.id), 0, "failed source remains due");
  assert.equal(config.lastSummaryAt(secondGuild.id), now, "successful source is checkpointed");
  assert.ok(records.includes("log_summary_error"));

  const retryAttempts = [];
  const retry = events.startLogMaintenance({
    client, sources: () => [GUILD.id, secondGuild.id], intervalMs: 60_000, now: () => now + 60_000,
    send: async (guild) => { retryAttempts.push(guild.id); return true; },
  });
  await retry.tick();
  retry.stop();
  assert.deepEqual(retryAttempts, [GUILD.id], "only the failed source is retried");
  assert.equal(config.lastSummaryAt(GUILD.id), now + 60_000);
  assert.equal(config.lastSummaryAt(secondGuild.id), now);
  assert.equal(config.lastSummaryAt(), now + 60_000);
});
