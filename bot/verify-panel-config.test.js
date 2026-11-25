import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-verify-")), "db.sqlite");
const { handleModerationInteraction } = await import("./moderation.js");

function interaction({ role = null, sent = [], replies = [] }) {
  const channel = { id: "c1", isTextBased: () => true, send: async (p) => sent.push(p) };
  const guild = {
    id: "g",
    members: { me: { roles: { highest: { position: 50 } } }, fetch: async () => null },
    channels: { fetch: async () => channel, cache: new Map() },
  };
  return {
    isButton: () => false, isModalSubmit: () => false, isChatInputCommand: () => true,
    commandName: "verify", guild, channel, user: { id: "u" },
    member: { permissions: { has: () => true } },
    options: { getSubcommand: () => "panel", getRole: () => role, getChannel: () => channel },
    reply: async (p) => replies.push(p),
  };
}

test("the test runner never inherits the production PostgreSQL URL", () => {
  assert.equal(
    process.env.SHARED_DATABASE_URL,
    undefined,
    "test-db-isolation must remove the production PostgreSQL URL inherited from PM2",
  );
});

test("/verify panel role:@Vérifié configures verification from Discord, then publishes", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ settings: { verification: { enabled: true, roleId: "r1", channelId: "c1", minAccountAgeDays: 7, message: "" } } }) };
  };
  const settings = {};
  const sent = [];
  const replies = [];
  await handleModerationInteraction(interaction({ role: { id: "r1", position: 10, managed: false }, sent, replies }), settings, { apiUrl: "http://x", secret: "s".repeat(32) });
  assert.equal(calls[0].module, "verification");
  assert.equal(calls[0].settings.enabled, true);
  assert.equal(calls[0].settings.roleId, "r1");
  assert.equal(settings.verification.roleId, "r1");
  assert.equal(sent.length, 1);
  assert.match(replies.at(-1).content, /Panneau de vérification envoyé/);
});

test("without a role and without configuration, the reply explains the one-line fix", async () => {
  const replies = [];
  await handleModerationInteraction(interaction({ replies }), {}, null);
  assert.match(replies.at(-1).content, /\/verify panel role:@Vérifié/);
});

test("a role above the bot is refused before anything is saved", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const replies = [];
  await handleModerationInteraction(interaction({ role: { id: "r9", position: 80, managed: false }, replies }), {}, { apiUrl: "http://x", secret: "s".repeat(32) });
  assert.equal(called, false);
  assert.match(replies.at(-1).content, /au-dessus du rôle choisi/);
});
