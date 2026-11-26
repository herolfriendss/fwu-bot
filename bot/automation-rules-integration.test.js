import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-automation-integration-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleAutomationRulesMessage } = await import("./automation-rules-commands.js");
const { previewGuildAutomationRules } = await import("./automation-rules-runtime.js");
const { getAutomationRun } = await import("./automation-rules.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function makeGuild() {
  const sent = [];
  const botMember = {
    permissions: { has: () => true },
    roles: { highest: { comparePositionTo: () => 10 } },
  };
  const makeChannel = (id) => ({
    id, guildId: "123456", isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    async send(payload) { sent.push({ channelId: id, payload }); return { id: `message-${sent.length}` }; },
  });
  const channels = new Map([["222222", makeChannel("222222")], ["333333", makeChannel("333333")]]);
  return {
    id: "123456", ownerId: "654321", sent,
    members: { me: botMember, async fetchMe() { return botMember; } },
    channels: { async fetch(id) { return channels.get(id) ?? null; } },
    roles: { async fetch() { return null; } },
  };
}

function makeMessage(guild, content, manageGuild = true) {
  const replies = [];
  return {
    guild, content, author: { id: "654321", bot: false },
    member: { permissions: { has: (permission) => permission === "ManageGuild" ? manageGuild : false } },
    replies,
    async reply(payload) { replies.push(payload); },
  };
}

test("rules can be configured, previewed in an approval channel and explicitly executed", async () => {
  const guild = makeGuild();
  const channelCommand = makeMessage(guild, "=autorule channel 222222");
  assert.equal(await handleAutomationRulesMessage(channelCommand), true);
  assert.match(channelCommand.replies[0].content, /Salon de validation défini/);

  const create = makeMessage(guild, "=autorule create member_join | Welcome | message 333333 | Bienvenue dans PND !");
  await handleAutomationRulesMessage(create);
  assert.match(create.replies[0].content, /Règle/);

  const details = { memberId: "777777", memberRoleIds: [], accountAgeDays: 90 };
  assert.equal(await previewGuildAutomationRules(guild, "member_join", "join-event-1", details, {}, () => {}), 1);
  const previewMessage = guild.sent.find((entry) => entry.channelId === "222222");
  assert.ok(previewMessage);
  const runId = previewMessage.payload.content.match(/=autorule confirm ([0-9a-f-]{36})/i)?.[1];
  assert.ok(runId);
  assert.equal(getAutomationRun(guild.id, runId).status, "previewed");

  const confirm = makeMessage(guild, `=autorule confirm ${runId}`);
  await handleAutomationRulesMessage(confirm);
  assert.match(confirm.replies[0].content, /Automatisation exécutée/);
  assert.equal(guild.sent.filter((entry) => entry.channelId === "333333").length, 1);
  assert.equal(getAutomationRun(guild.id, runId).status, "executed");
});

test("rule events are not delivered without an approval destination", async () => {
  db.prepare("DELETE FROM automation_rule_settings").run();
  db.prepare("DELETE FROM automation_runs").run();
  db.prepare("DELETE FROM automation_rules").run();
  const guild = makeGuild();
  const create = makeMessage(guild, "=autorule create member_join | Welcome | message 333333 | Bienvenue !");
  await handleAutomationRulesMessage(create);
  assert.equal(await previewGuildAutomationRules(guild, "member_join", "join-event-2", { memberId: "777777" }, {}, () => {}), 0);
  assert.equal(guild.sent.length, 0);
});

test("automation previews never reject: a storage or Discord failure is recorded instead", async () => {
  const guild = makeGuild();
  const channelCommand = makeMessage(guild, "=autorule channel 222222");
  await handleAutomationRulesMessage(channelCommand);
  await handleAutomationRulesMessage(makeMessage(guild, "=autorule create member_join | Welcome | message 333333 | Bienvenue !"));
  // A synchronous throw before the per-rule loop used to escape as an unhandled rejection.
  guild.channels.fetch = () => { throw new Error("boom"); };
  const codes = [];
  assert.equal(await previewGuildAutomationRules(guild, "member_join", "join-event-3", { memberId: "777777" }, {}, (code) => codes.push(code)), 0);
  assert.deepEqual(codes, ["automation_preview_error"]);
});
