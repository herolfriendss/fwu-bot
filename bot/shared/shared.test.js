// Tests de la base centrale sur un vrai PostgreSQL.
// Lancement : SHARED_DATABASE_URL_TEST=postgres://… npm test
// Sans cette variable, les tests qui ont besoin de PostgreSQL sont ignorés
// (les tests purs tournent toujours). Chaque exécution crée puis supprime
// son propre schéma : la base de production n'est jamais touchée.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

import { closeSharedDb, initSharedDb, sharedDbAvailable, sharedQuery } from "./db.js";
import { runSharedMigrations } from "./migrate.js";
import { consumeQuota, formatDurationFr, formatQuotaRefusal, refundQuota, setQuota, resetQuota, addExemption, removeExemption, addWhitelistedBot, removeWhitelistedBot, listQuotas } from "./quotas.js";
import { resolveTier, tierFromRoleName, setRoleTier, loadRoleTiers, canUseModeration } from "./tiers.js";
import { listSanctionTypes, addSanctionType, updateSanctionType, deleteSanctionType, listMemberSanctions, parseDurationToSeconds } from "./sanctions.js";
import { flushOutbox, logCommandUsage, pendingOutboxEntries, recordSanction, setOutboxPathForTests } from "./audit.js";
import { SHARED_DB_ALERTS, createSharedDbAlerter, formatSharedDbLine } from "./index.js";

const TEST_URL = process.env.SHARED_DATABASE_URL_TEST;
const pgTest = TEST_URL ? test : test.skip;
const schema = `fwu_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const OWNER = "100000000000000001";
const G = "200000000000000001";
const outboxDir = mkdtempSync(join(tmpdir(), "fwu-outbox-"));

before(async () => {
  setOutboxPathForTests(join(outboxDir, "outbox.jsonl"));
  if (!TEST_URL) return;
  const admin = new pg.Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  await initSharedDb({ SHARED_DATABASE_URL: TEST_URL, SHARED_DATABASE_SCHEMA: schema, PND_BOT_PROFILE: "test" });
  await runSharedMigrations();
});

after(async () => {
  await closeSharedDb();
  if (!TEST_URL) return;
  const admin = new pg.Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

// ── Tests purs ─────────────────────────────────────────────────────────────

test("le palier se lit dans le nom des rôles", () => {
  assert.equal(tierFromRoleName("10%"), 10);
  assert.equal(tierFromRoleName("10 %"), 10);
  assert.equal(tierFromRoleName("1% All Access"), 1);
  assert.equal(tierFromRoleName("50% · Modérateur test"), 50);
  assert.equal(tierFromRoleName("Top 100%"), 100);
  assert.equal(tierFromRoleName("15%"), null);
  assert.equal(tierFromRoleName("0%"), null, "le palier owner ne se déduit jamais d'un nom de rôle");
  assert.equal(tierFromRoleName("0 % Owner"), null);
  assert.equal(tierFromRoleName("Modérateur"), null);
});

test("le membre prend le palier le plus fort ; l'owner est toujours au palier 0", () => {
  const roles = [{ id: "a", name: "100%" }, { id: "b", name: "10% Modérateur" }, { id: "c", name: "50%" }];
  assert.equal(resolveTier({ userId: "u", roles }), 10);
  assert.equal(resolveTier({ userId: "u", roles, explicit: new Map([["c", 1]]) }), 1);
  assert.equal(resolveTier({ userId: OWNER, roles: [], owner: OWNER }), 0);
  assert.equal(resolveTier({ userId: "u", roles: [{ id: "x", name: "Membre" }] }), null);
  assert.equal(canUseModeration(50), true);
  assert.equal(canUseModeration(70), false);
  assert.equal(canUseModeration(null), false);
});

test("durées : saisie et affichage en français", () => {
  assert.equal(parseDurationToSeconds("10m"), 600);
  assert.equal(parseDurationToSeconds("1h30"), 5400);
  assert.equal(parseDurationToSeconds("2j"), 172800);
  assert.equal(parseDurationToSeconds("45"), 2700);
  assert.equal(parseDurationToSeconds("abc"), null);
  assert.equal(formatDurationFr(1800), "30 min");
  assert.equal(formatDurationFr(86400), "1 j");
  assert.equal(formatDurationFr(5430), "1 h 31 min");
  assert.equal(formatDurationFr(12), "12 s");
});

test("le message de refus indique le temps restant", () => {
  const text = formatQuotaRefusal({ allowed: false, reason: "quota", tier: 50, maxUses: 2, windowSeconds: 1800, retryAfterSeconds: 600 }, "tempmute");
  assert.match(text, /2 \/ 30 min/);
  assert.match(text, /10 min/);
  assert.match(formatQuotaRefusal({ reason: "unavailable" }, "ban"), /injoignable/);
});

// ── Base centrale ─────────────────────────────────────────────────────────

pgTest("les migrations s'appliquent une seule fois", async () => {
  assert.deepEqual(await runSharedMigrations(), []);
  const { rows } = await sharedQuery("SELECT count(*)::int AS n FROM schema_migrations");
  assert.equal(rows[0].n, 3);
});

pgTest("quotas par défaut : Modérateur test = 2 tempmute / 30 min, puis refus avec délai", async () => {
  const user = "300000000000000001";
  const first = await consumeQuota({ guildId: G, userId: user, command: "tempmute", tier: 50, bot: "fwu" });
  const second = await consumeQuota({ guildId: G, userId: user, command: "tempmute", tier: 50, bot: "fwu" });
  const third = await consumeQuota({ guildId: G, userId: user, command: "tempmute", tier: 50, bot: "fwu" });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.reason, "quota");
  assert.ok(third.retryAfterSeconds > 1790 && third.retryAfterSeconds <= 1800, `retry ${third.retryAfterSeconds}`);
  const { rows } = await sharedQuery("SELECT count(*)::int AS n FROM quota_violations WHERE user_id = $1", [user]);
  assert.equal(rows[0].n, 1, "le dépassement est journalisé");
});

pgTest("atomicité : 30 commandes simultanées ne dépassent jamais la limite", async () => {
  const user = "300000000000000002";
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    consumeQuota({ guildId: G, userId: user, command: "tempmute", tier: 10, bot: i % 2 ? "guard" : "fwu" })));
  assert.equal(results.filter((r) => r.allowed).length, 4);
  assert.equal(results.filter((r) => r.reason === "quota").length, 26);
});

pgTest("le compteur est partagé entre les bots", async () => {
  const user = "300000000000000003";
  assert.equal((await consumeQuota({ guildId: G, userId: user, command: "kick", tier: 50, bot: "guard" })).allowed, true);
  const other = await consumeQuota({ guildId: G, userId: user, command: "kick", tier: 50, bot: "fwu" });
  assert.equal(other.allowed, false);
  assert.equal(other.reason, "quota");
});

pgTest("accès : ban interdit au 50 %, aucune modération pour 70/80/100 %", async () => {
  const user = "300000000000000004";
  assert.equal((await consumeQuota({ guildId: G, userId: user, command: "ban", tier: 50, bot: "guard" })).reason, "command_forbidden");
  for (const tier of [70, 80, 100, null]) {
    assert.equal((await consumeQuota({ guildId: G, userId: user, command: "tempmute", tier, bot: "fwu" })).reason, "no_access");
  }
});

pgTest("l'owner (0 %) est illimité", async () => {
  for (let i = 0; i < 20; i++) {
    assert.equal((await consumeQuota({ guildId: G, userId: OWNER, command: "ban", tier: 0, bot: "guard" })).allowed, true);
  }
});

pgTest("une usage remboursée libère la place", async () => {
  const user = "300000000000000005";
  const used = await consumeQuota({ guildId: G, userId: user, command: "ban", tier: 10, bot: "guard" });
  assert.equal(used.allowed, true);
  assert.equal((await consumeQuota({ guildId: G, userId: user, command: "ban", tier: 10, bot: "guard" })).allowed, false);
  assert.equal(await refundQuota(used.usageId), true);
  assert.equal((await consumeQuota({ guildId: G, userId: user, command: "ban", tier: 10, bot: "guard" })).allowed, true);
});

pgTest("les usages sortis de la fenêtre ne comptent plus", async () => {
  const user = "300000000000000006";
  await sharedQuery("INSERT INTO quota_usage(guild_id, user_id, command, bot, used_at) VALUES ($1, $2, 'kick', 'guard', now() - interval '25 hours')", [G, user]);
  assert.equal((await consumeQuota({ guildId: G, userId: user, command: "kick", tier: 50, bot: "guard" })).allowed, true);
});

pgTest("exemption par ID et whitelist de bots (owner uniquement, journalisées)", async () => {
  const user = "300000000000000007";
  const botId = "300000000000000099";
  await assert.rejects(addExemption({ guildId: G, userId: user, actorId: user, owner: OWNER, bot: "fwu" }), /Seul l'owner/);
  await addExemption({ guildId: G, userId: user, reason: "test", actorId: OWNER, owner: OWNER, bot: "fwu" });
  for (let i = 0; i < 5; i++) assert.equal((await consumeQuota({ guildId: G, userId: user, command: "ban", tier: 50, bot: "guard" })).allowed, true);
  await removeExemption({ guildId: G, userId: user, actorId: OWNER, owner: OWNER, bot: "fwu" });
  assert.equal((await consumeQuota({ guildId: G, userId: user, command: "ban", tier: 50, bot: "guard" })).allowed, false);

  assert.equal((await consumeQuota({ guildId: G, userId: botId, command: "kick", tier: null, bot: "guard", isBot: true })).reason, "bot_not_whitelisted");
  await addWhitelistedBot({ guildId: G, botId, actorId: OWNER, owner: OWNER, bot: "fwu" });
  assert.equal((await consumeQuota({ guildId: G, userId: botId, command: "kick", tier: null, bot: "guard", isBot: true })).allowed, true);
  await removeWhitelistedBot({ guildId: G, botId, actorId: OWNER, owner: OWNER, bot: "fwu" });

  const { rows } = await sharedQuery("SELECT entity, before, after FROM config_changes WHERE guild_id = $1 AND entity IN ('quota_exemption', 'bot_whitelist') ORDER BY id", [G]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].before, { exempt: true, reason: "test" });
  assert.equal(rows[1].after, null);
});

pgTest("modification à chaud d'un quota : effet immédiat, avant/après journalisés", async () => {
  const user = "300000000000000008";
  const G2 = "200000000000000002";
  await assert.rejects(setQuota({ guildId: G2, command: "tempmute", tier: 50, maxUses: 1, windowSeconds: 600, actorId: user, owner: OWNER, bot: "fwu" }), /Seul l'owner/);
  const change = await setQuota({ guildId: G2, command: "tempmute", tier: 50, maxUses: 1, windowSeconds: 600, actorId: OWNER, owner: OWNER, bot: "fwu" });
  assert.deepEqual(change.before, { maxUses: 2, windowSeconds: 1800, isDefault: true });
  assert.equal((await consumeQuota({ guildId: G2, userId: user, command: "tempmute", tier: 50, bot: "fwu" })).allowed, true);
  const refused = await consumeQuota({ guildId: G2, userId: user, command: "tempmute", tier: 50, bot: "fwu" });
  assert.equal(refused.maxUses, 1);
  assert.equal(refused.windowSeconds, 600);
  // L'autre serveur garde la valeur par défaut.
  const effective = (await listQuotas(G)).find((q) => q.command === "tempmute" && q.tier === 50);
  assert.deepEqual([effective.maxUses, effective.isDefault], [2, true]);
  await resetQuota({ guildId: G2, command: "tempmute", tier: 50, actorId: OWNER, owner: OWNER, bot: "fwu" });
  assert.equal((await listQuotas(G2)).find((q) => q.command === "tempmute" && q.tier === 50).isDefault, true);
  const { rows } = await sharedQuery("SELECT count(*)::int AS n FROM config_changes WHERE guild_id = $1 AND entity = 'quota'", [G2]);
  assert.equal(rows[0].n, 2);
});

pgTest("paliers explicites en base", async () => {
  await setRoleTier({ guildId: G, roleId: "role-1", tier: 5, actorId: OWNER, bot: "fwu" });
  assert.equal((await loadRoleTiers(G)).get("role-1"), 5);
  await setRoleTier({ guildId: G, roleId: "role-1", tier: null, actorId: OWNER, bot: "fwu" });
  assert.equal((await loadRoleTiers(G)).has("role-1"), false);
});

pgTest("types de sanctions : défauts, ajout, modification, suppression journalisés", async () => {
  const G3 = "200000000000000003";
  const defaults = await listSanctionTypes(G3);
  assert.deepEqual(defaults.map((t) => [t.name, t.durationSeconds]), [
    ["Propos déplacés", 600], ["Insultes légères", 900], ["Insultes graves", 1800], ["Discrimination", 3600],
  ]);
  const spam = await addSanctionType({ guildId: G3, name: "Spam", durationSeconds: 300, actorId: "a", bot: "fwu" });
  await assert.rejects(addSanctionType({ guildId: G3, name: "spam", durationSeconds: 300, actorId: "a", bot: "fwu" }), /existe déjà/);
  await updateSanctionType({ guildId: G3, id: spam.id, durationSeconds: 1200, actorId: "a", bot: "fwu" });
  const discrimination = defaults.find((t) => t.name === "Discrimination");
  await deleteSanctionType({ guildId: G3, id: discrimination.id, actorId: "a", bot: "fwu" });
  const now = await listSanctionTypes(G3);
  assert.equal(now.find((t) => t.name === "Spam").durationSeconds, 1200);
  assert.equal(now.some((t) => t.name === "Discrimination"), false, "un défaut supprimé ne revient pas");
  const { rows } = await sharedQuery("SELECT count(*)::int AS n FROM config_changes WHERE guild_id = $1 AND entity = 'sanction_type'", [G3]);
  assert.equal(rows[0].n, 3);
});

pgTest("historique des sanctions d'un membre", async () => {
  const target = "400000000000000001";
  await recordSanction({ guildId: G, targetId: target, moderatorId: "m1", action: "tempmute", sanctionLabel: "Insultes graves", reason: "x", durationSeconds: 1800, bot: "fwu" });
  await recordSanction({ guildId: G, targetId: target, moderatorId: "m2", action: "kick", reason: "y", bot: "guard" });
  const history = await listMemberSanctions(G, target);
  assert.equal(history.total, 2);
  assert.deepEqual(history.items.map((s) => s.action).sort(), ["kick", "tempmute"]);
});

pgTest("base injoignable : refus propre, owner toujours servi, logs mis en file puis renvoyés", async () => {
  await closeSharedDb();
  assert.equal(sharedDbAvailable(), false);
  const refused = await consumeQuota({ guildId: G, userId: "300000000000000010", command: "tempmute", tier: 1, bot: "fwu" });
  assert.equal(refused.reason, "unavailable");
  assert.equal((await consumeQuota({ guildId: G, userId: OWNER, command: "ban", tier: 0, bot: "guard" })).allowed, true);
  await logCommandUsage({ guildId: G, userId: "u", bot: "fwu", command: "tempmute", outcome: "unavailable" });
  assert.equal(pendingOutboxEntries(), 1);
  await initSharedDb({ SHARED_DATABASE_URL: TEST_URL, SHARED_DATABASE_SCHEMA: schema, PND_BOT_PROFILE: "test" });
  assert.equal(await flushOutbox(), 1);
  assert.equal(pendingOutboxEntries(), 0);
  const { rows } = await sharedQuery("SELECT count(*)::int AS n FROM command_usage WHERE outcome = 'unavailable'");
  assert.equal(rows[0].n, 1);
});

pgTest("connexion à une base éteinte : aucun crash, état indisponible", async () => {
  await closeSharedDb();
  await initSharedDb({ SHARED_DATABASE_URL: "postgres://x:y@127.0.0.1:1/none" });
  assert.equal(sharedDbAvailable(), false);
  assert.equal((await consumeQuota({ guildId: G, userId: "u", command: "kick", tier: 1, bot: "guard" })).reason, "unavailable");
  await closeSharedDb();
  await initSharedDb({ SHARED_DATABASE_URL: TEST_URL, SHARED_DATABASE_SCHEMA: schema, PND_BOT_PROFILE: "test" });
  assert.equal(sharedDbAvailable(), true);
  assert.ok(!existsSync(join(outboxDir, "outbox.jsonl")) || readFileSync(join(outboxDir, "outbox.jsonl"), "utf8").trim() === "");
});

pgTest("porte de modération : palier lu sur les rôles, refus clair, remboursement sur échec", async () => {
  const { openModerationGate } = await import("./moderation-gate.js");
  const fakeMember = (id, roleName) => ({
    id, user: { id, bot: false }, guild: { id: "200000000000000009" },
    roles: { cache: new Map([["r", { id: "r", name: roleName }]]) },
  });
  const mod = fakeMember("500000000000000001", "50% Modérateur test");
  const first = await openModerationGate({ member: mod, command: "kick", bot: "guard", env: {} });
  assert.equal(first.ok, true);
  await first.fail(new Error("Missing Permissions"));
  const again = await openModerationGate({ member: mod, command: "kick", bot: "guard", env: {} });
  assert.equal(again.ok, true, "l'échec a rendu l'usage");
  await again.succeed();
  const refused = await openModerationGate({ member: mod, command: "kick", bot: "guard", env: {} });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Quota atteint/);
  const member100 = fakeMember("500000000000000002", "100%");
  assert.match((await openModerationGate({ member: member100, command: "warn", bot: "fwu", env: {} })).message, /n'a pas accès/);
  const { rows } = await sharedQuery("SELECT outcome FROM command_usage WHERE guild_id = '200000000000000009' ORDER BY id");
  assert.deepEqual(rows.map((r) => r.outcome), ["error", "ok", "quota", "denied"]);
});

test("base centrale : alerte après 2 min de coupure seulement, puis « revenue » une fois", () => {
  const sent = [];
  const timers = [];
  const alerter = createSharedDbAlerter({ notify: (k) => sent.push(k), setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: (id) => { timers[id - 1] = null; } });
  alerter.change(false);
  alerter.change(false);
  assert.equal(timers.length, 1, "une seule attente même si plusieurs signaux");
  alerter.change(true);
  assert.deepEqual(sent, [], "coupure courte : personne n'est dérangé");
  alerter.change(false);
  timers.at(-1)();
  assert.deepEqual(sent, ["down"]);
  alerter.change(false);
  alerter.change(true);
  alerter.change(true);
  assert.deepEqual(sent, ["down", "up"]);
  alerter.notConfigured();
  assert.deepEqual(sent, ["down", "up", "not_configured"]);
});

test("base centrale : ligne du diagnostic", () => {
  assert.match(formatSharedDbLine({ configured: false, available: false }), /non installée.*tempmute/);
  assert.match(formatSharedDbLine({ configured: true, available: true }), /🟢 Base centrale : joignable/);
  assert.match(formatSharedDbLine({ configured: true, available: false }, 1_700_000_000_000), /injoignable\*\* depuis <t:1700000000:R>/);
  assert.match(SHARED_DB_ALERTS.not_configured.description, /install-shared-db\.sh/);
});

pgTest("purge : usages de plus de 31 jours et commandes de plus de 90 jours, le reste est gardé", async () => {
  const { purgeOldUsage } = await import("./retention.js");
  await sharedQuery("DELETE FROM quota_usage WHERE guild_id = 'purge'");
  await sharedQuery("DELETE FROM command_usage WHERE guild_id = 'purge'");
  for (const days of [1, 29, 32]) await sharedQuery("INSERT INTO quota_usage(guild_id, user_id, command, bot, used_at) VALUES ('purge', 'u', 'ban', 'fwu', now() - make_interval(days => $1))", [days]);
  for (const days of [1, 89, 91]) await sharedQuery("INSERT INTO command_usage(guild_id, user_id, bot, command, outcome, created_at) VALUES ('purge', 'u', 'fwu', 'ban', 'ok', now() - make_interval(days => $1))", [days]);
  const removed = await purgeOldUsage();
  assert.ok(removed.quota_usage >= 1 && removed.command_usage >= 1);
  assert.equal(Number((await sharedQuery("SELECT COUNT(*) n FROM quota_usage WHERE guild_id = 'purge'")).rows[0].n), 2);
  assert.equal(Number((await sharedQuery("SELECT COUNT(*) n FROM command_usage WHERE guild_id = 'purge'")).rows[0].n), 2);
});
