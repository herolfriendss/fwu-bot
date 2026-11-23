import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-intelligence-store-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { createPndIntelligenceAction, expirePendingPndIntelligenceActions, recoverInterruptedPndIntelligenceActions } = await import("./pnd-intelligence-store.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("PND Intelligence action previews are guild scoped and expire after ten minutes", () => {
  const pending = createPndIntelligenceAction({
    guildId: "123456", requesterId: "234567", sourceChannelId: "345678",
    action: { type: "create_category", name: "Staff" }, now: 10_000,
  });
  assert.equal(pending.expiresAt, 610_000);
  assert.equal(db.prepare("SELECT guild_id FROM pnd_intelligence_actions WHERE action_id=?").get(pending.actionId).guild_id, "123456");
  assert.throws(() => createPndIntelligenceAction({ guildId: "999999", requesterId: "234567", sourceChannelId: "345678", action: { type: "ban_all" } }), /Action PND Intelligence invalide/);
  assert.equal(expirePendingPndIntelligenceActions(609_999), 0);
  assert.equal(expirePendingPndIntelligenceActions(610_000), 1);
  assert.equal(db.prepare("SELECT status FROM pnd_intelligence_actions WHERE action_id=?").get(pending.actionId).status, "expired");
});


test("PND Intelligence store accepts every explicitly validated safe action and stores only normalized fields", () => {
  const pending = createPndIntelligenceAction({
    guildId: "123456", requesterId: "234567", sourceChannelId: "345678",
    action: { type: "rename_channel", channelId: "456789", name: "Annonces générales", ignored: "must not persist" }, now: 20_000,
  });
  assert.deepEqual(pending.action, { type: "rename_channel", channelId: "456789", name: "annonces-generales" });
  const stored = JSON.parse(db.prepare("SELECT action_json FROM pnd_intelligence_actions WHERE action_id=?").get(pending.actionId).action_json);
  assert.deepEqual(stored, pending.action);
  assert.throws(() => createPndIntelligenceAction({
    guildId: "123456", requesterId: "234567", sourceChannelId: "345678",
    action: { type: "set_channel_slowmode", channelId: "456789", seconds: 21601 }, now: 20_000,
  }), /mode lent invalide/i);
});


test("PND Intelligence store supports the complete safe action family exposed by its command parser", () => {
  const actions = [
    { type: "create_text_channel", name: "Annonces", categoryName: null },
    { type: "create_voice_channel", name: "Réunion", categoryName: "Équipe" },
    { type: "create_role", name: "Animateur" },
    { type: "set_channel_topic", channelId: "456789", topic: "Bienvenue" },
    { type: "set_channel_slowmode", channelId: "456789", seconds: 15 },
  ];
  for (const [index, action] of actions.entries()) {
    const pending = createPndIntelligenceAction({
      guildId: "123456", requesterId: "234567", sourceChannelId: "345678", action, now: 30_000 + index,
    });
    const stored = JSON.parse(db.prepare("SELECT action_json FROM pnd_intelligence_actions WHERE action_id=?").get(pending.actionId).action_json);
    assert.deepEqual(stored, pending.action);
  }
});


test("interrupted confirmed actions are marked unknown and never re-queued", () => {
  const pending = createPndIntelligenceAction({
    guildId: "123456", requesterId: "234567", sourceChannelId: "345678",
    action: { type: "create_category", name: "Staff" }, now: 100_000,
  });
  db.prepare("UPDATE pnd_intelligence_actions SET status='processing',decided_by=?,decided_at=? WHERE action_id=?")
    .run("456789", 110_000, pending.actionId);

  assert.equal(recoverInterruptedPndIntelligenceActions(409_999, 300_000), 0);
  assert.equal(recoverInterruptedPndIntelligenceActions(410_000, 300_000), 1);
  const row = db.prepare("SELECT status,result_json FROM pnd_intelligence_actions WHERE action_id=?").get(pending.actionId);
  assert.equal(row.status, "failed");
  assert.equal(JSON.parse(row.result_json).outcome, "unknown");
  assert.equal(recoverInterruptedPndIntelligenceActions(500_000, 300_000), 0);
});
