import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-logs-commands-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const OWNER = "900000000000000009";
const env = { PND_OWNER_DISCORD_ID: OWNER };

const { runLogsCommand } = await import("./logs-commands.js");
const { logEvent } = await import("./log-events.js");
const config = await import("./logs-config.js");
const { db } = await import("./database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const guild = { id: "1562643485981544559", ownerId: "100000000000000001" };
const staff = { id: "200000000000000002", permissions: { has: () => true }, roles: { cache: { has: () => false } } };
const member = { id: "300000000000000003", permissions: { has: () => false }, roles: { cache: { has: () => false } } };

test("configuration is OWNER-only, search and cases are staff-only", async () => {
  assert.match((await runLogsCommand({ guild, member: staff, userId: staff.id, sub: "hub", serveur: "111111111111111111" }, { env })).content, /OWNER/);
  assert.match((await runLogsCommand({ guild, member, userId: member.id, sub: "rechercher" }, { env })).content, /staff/);
  assert.match((await runLogsCommand({ guild, member, userId: member.id, sub: "dossier", numero: 1 }, { env })).content, /staff/);
  const ok = await runLogsCommand({ guild, member: staff, userId: OWNER, sub: "hub", serveur: "111111111111111111" }, { env });
  assert.match(ok.content, /✅/);
  assert.equal(config.logsHubGuildId(env), "111111111111111111");
  assert.equal(ok.visibility, "private");
});

test("MZ cannot be activated from /logs and a new source gets its own channel set", async () => {
  const refused = await runLogsCommand({ guild, member: staff, userId: OWNER, sub: "source-activer", serveur: "1505904703563894814", actif: true }, { env });
  assert.match(refused.content, /MZ reste désactivé/);
  await runLogsCommand({ guild, member: staff, userId: OWNER, sub: "source-ajouter", serveur: "222222222222222222", nom: "test", libelle: "Test" }, { env });
  await runLogsCommand({ guild, member: staff, userId: OWNER, sub: "source-activer", serveur: "222222222222222222", actif: true }, { env });
  const { logChannelForGuild } = await import("./logs-hub.js");
  assert.equal(logChannelForGuild("222222222222222222", "", "moderation").name, "test-logs-sanctions");
  assert.equal(logChannelForGuild(guild.id, "", "moderation").name, "logs-sanctions");
});

test("/dossier shows the case and /logs rechercher finds it", async () => {
  const { caseNumber } = await logEvent(guild, null, { category: "moderation", action: "ban", severity: "warning", actorId: staff.id, targetId: member.id, reason: "spam" }, { send: async () => true });
  const view = await runLogsCommand({ guild, member: staff, userId: staff.id, sub: "dossier", numero: caseNumber }, { env });
  assert.match(JSON.stringify(view.embeds), /spam/);
  const found = await runLogsCommand({ guild, member: staff, userId: staff.id, sub: "rechercher", membreId: member.id, periode: "7j" }, { env });
  assert.match(found.content, /Bannissement/);
  const timeline = await runLogsCommand({ guild, member: staff, userId: staff.id, sub: "chronologie", membreId: member.id }, { env });
  assert.match(timeline.content, /Chronologie/);
});
