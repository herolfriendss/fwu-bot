import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pnd-verification-"));
process.env.HER_DB_PATH = join(tempDir, "test.sqlite");

const { db } = await import("./database.js");
const {
  handleReactionVerificationCommand,
  handleReactionVerificationReaction,
} = await import("./reaction-verification.js");

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("publie le règlement, attribue le rôle uniquement sur le bon message et désactive le panneau", async () => {
  const guildId = "guild-test";
  const channelId = "channel-access";
  const roleId = "role-verified";
  const userId = "member-test";
  const assigned = [];
  const replies = [];

  const role = {
    id: roleId,
    managed: false,
    position: 5,
    permissions: { has: () => false },
  };

  const botMember = {
    permissions: { has: () => true },
    roles: { highest: { position: 10 } },
  };

  const member = { id: userId, roles: null };
  member.roles = {
    cache: new Map(),
    add: async (givenRole, reason) => {
      assigned.push({ roleId: givenRole.id, reason });
      member.roles.cache.set(givenRole.id, givenRole);
    },
  };

  const actor = {
    id: "admin-test",
    permissions: { has: () => true },
  };

  const guild = {
    id: guildId,
    roles: {
      everyone: { id: guildId },
      fetch: async (id) => id === roleId ? role : null,
    },
    members: {
      fetchMe: async () => botMember,
      fetch: async (id) => id === userId ? member : null,
    },
  };

  const panelMessage = {
    id: "panel-test",
    guildId,
    channelId,
    guild,
    partial: false,
    react: async (emoji) => assert.equal(emoji, "✅"),
  };

  const channel = {
    id: channelId,
    guildId,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async ({ embeds }) => {
      assert.equal(embeds.length, 1);
      return panelMessage;
    },
  };

  const commandMessage = {
    content: "=verification #acces @Verifie",
    guild,
    member: actor,
    author: { id: actor.id },
    mentions: {
      channels: { first: () => channel },
      roles: { first: () => role },
    },
    reply: async (payload) => replies.push(payload),
  };

  assert.equal(await handleReactionVerificationCommand(commandMessage), true);

  const config = db.prepare(
    "SELECT * FROM reaction_verification_panels WHERE guild_id=?"
  ).get(guildId);

  assert.equal(config.channel_id, channelId);
  assert.equal(config.message_id, panelMessage.id);
  assert.equal(config.role_id, roleId);

  const reaction = {
    partial: false,
    emoji: { name: "✅" },
    message: panelMessage,
  };

  assert.equal(
    await handleReactionVerificationReaction(reaction, { id: userId, bot: false }),
    true
  );
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].roleId, roleId);

  const unrelated = {
    ...reaction,
    message: { ...panelMessage, id: "other-message" },
  };

  assert.equal(
    await handleReactionVerificationReaction(unrelated, { id: "another-member", bot: false }),
    false
  );
  assert.equal(assigned.length, 1);

  const offMessage = {
    content: "=verification off",
    guild,
    member: actor,
    reply: async (payload) => replies.push(payload),
  };

  assert.equal(await handleReactionVerificationCommand(offMessage), true);
  assert.equal(
    db.prepare("SELECT * FROM reaction_verification_panels WHERE guild_id=?").get(guildId),
    undefined
  );
});
