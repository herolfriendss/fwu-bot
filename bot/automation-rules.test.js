import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-automation-rules-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const service = await import("./automation-rules.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("automation previews are guild-scoped and require explicit confirmation before execution", async () => {
  const rule = service.createAutomationRule("123456", "654321", {
    name: "Welcome",
    triggerType: "member_join",
    conditions: { minAccountAgeDays: 7 },
    actions: [{ type: "send_message", channelId: "111111", content: "Bienvenue !" }],
  }, 1_000);
  const event = { id: "gateway-event-1", guildId: "123456", type: "member_join", memberId: "777777", accountAgeDays: 30 };
  const preview = service.previewAutomationEvent("123456", rule.ruleId, event, "654321", 2_000);
  assert.equal(preview.status, "previewed");
  assert.equal(preview.preview.requiresConfirmation, true);
  assert.deepEqual(await service.executeConfirmedAutomation("123456", preview.runId, async () => ({})), {
    executed: false, reason: "not_confirmed_or_already_processed",
  });
  assert.throws(() => service.confirmAutomationRun("123456", preview.runId, "777777", { authorizeActor: () => false, now: 3_000 }), /Permission/);
  service.confirmAutomationRun("123456", preview.runId, "654321", { authorizeActor: () => true, now: 3_000 });
  const executed = await service.executeConfirmedAutomation("123456", preview.runId, async ({ guildId, action }) => ({ guildId, type: action.type }), 4_000);
  assert.equal(executed.executed, true);
  assert.equal(executed.results[0].guildId, "123456");
  assert.equal((await service.executeConfirmedAutomation("123456", preview.runId, async () => ({}))).executed, false);
  assert.equal(service.getAutomationRule("999999", rule.ruleId), null);
});

test("nonmatching conditions are recorded as skipped and duplicate gateway events are idempotent", () => {
  const rule = service.createAutomationRule("123456", "654321", {
    name: "Age gate",
    triggerType: "member_join",
    conditions: { minAccountAgeDays: 30 },
    actions: [{ type: "add_role", roleId: "111111" }],
  });
  const event = { id: "gateway-event-2", guildId: "123456", type: "member_join", memberId: "777777", accountAgeDays: 2 };
  const first = service.previewAutomationEvent("123456", rule.ruleId, event);
  const replay = service.previewAutomationEvent("123456", rule.ruleId, event);
  assert.equal(first.status, "skipped");
  assert.equal(first.preview.matches, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.runId, first.runId);
});

test("unsafe actions, unsupported conditions and expired previews are rejected", () => {
  assert.throws(() => service.validateAutomationRule({ name: "bad", triggerType: "member_join", actions: [{ type: "ban" }] }), /non autorisée/);
  assert.throws(() => service.validateAutomationRule({ name: "message flood", triggerType: "message_created", actions: [{ type: "send_message", channelId: "111111", content: "Hi" }] }), /cibler un salon ou un rôle/);
  assert.throws(() => service.validateAutomationRule({ name: "bad", triggerType: "member_join", conditions: { isOwner: true }, actions: [{ type: "add_role", roleId: "111111" }] }), /non prise en charge/);
  assert.throws(() => service.validateAutomationRule({ name: "scheduled", triggerType: "scheduled", actions: [{ type: "send_message", channelId: "111111", content: "Ping" }] }), /intervalMinutes/);
  assert.throws(() => service.validateAutomationRule({ name: "scheduled", triggerType: "scheduled", conditions: { intervalMinutes: 30 }, actions: [{ type: "send_message", channelId: "111111", content: "Ping" }] }), /60 et 43 200/);
  const rule = service.createAutomationRule("123456", "654321", { name: "Expire", triggerType: "scheduled", conditions: { intervalMinutes: 60 }, actions: [{ type: "remove_role", roleId: "111111" }] }, 1_000);
  const preview = service.previewAutomationEvent("123456", rule.ruleId, { id: "old-event", guildId: "123456", type: "scheduled" }, null, 1_000);
  assert.throws(() => service.confirmAutomationRun("123456", preview.runId, "654321", { authorizeActor: () => true, now: 1_000 + 16 * 60_000 }), /expiré/);
});

test("message automations are rate limited per rule to prevent approval-channel floods", () => {
  const rule = service.createAutomationRule("123456", "654321", {
    name: "Channel rule", triggerType: "message_created", conditions: { channelId: "111111" },
    actions: [{ type: "send_message", channelId: "111111", content: "Acknowledged" }],
  });
  const results = [];
  for (let index = 0; index < 11; index++) {
    results.push(service.previewAutomationEvent("123456", rule.ruleId, {
      id: `message-event-${index}`, guildId: "123456", type: "message_created", channelId: "111111",
    }, null, 10_000 + index));
  }
  assert.equal(results.filter((result) => result.status === "previewed").length, 10);
  assert.equal(results[10].status, "skipped");
  assert.match(results[10].preview.note, /Débit limité/);
});


test("scheduled automation previews are stable once per configured interval", () => {
  const rule = service.createAutomationRule("123456", "654321", {
    name: "Hourly reminder", triggerType: "scheduled", conditions: { intervalMinutes: 60 },
    actions: [{ type: "send_message", channelId: "111111", content: "Reminder" }],
  });
  const event = { id: "scheduled:2026-11-16T10", guildId: "123456", type: "scheduled" };
  const first = service.previewAutomationEvent("123456", rule.ruleId, event, null, 100_000);
  const replay = service.previewAutomationEvent("123456", rule.ruleId, event, null, 101_000);
  assert.equal(first.status, "previewed");
  assert.equal(replay.duplicate, true);
  assert.equal(replay.runId, first.runId);
});
