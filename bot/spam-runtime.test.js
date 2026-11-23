import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { enforceMentionFlood } from "./spam-runtime.js";

function fakeMessage({ mentions = 6, permissions = [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers], roles = [] } = {}) {
  const calls = [];
  const member = {
    guild: { id: "guild-a" },
    roles: { cache: new Set(roles) },
    permissions: { has: () => false },
    timeout: async (duration, reason) => calls.push(["timeout", duration, reason]),
  };
  const botMember = {};
  const message = {
    member,
    author: { id: "member-a" },
    mentions: { users: { size: mentions }, roles: { size: 0 }, everyone: false },
    guild: { members: { me: botMember } },
    channel: {
      permissionsFor: () => ({ has: (permission) => permissions.includes(permission) }),
      send: async (payload) => calls.push(["send", payload]),
    },
    delete: async () => calls.push(["delete"]),
  };
  return { message, calls };
}

test("mention flood removes the message and applies the configured timeout", async () => {
  const { message, calls } = fakeMessage();
  assert.equal(await enforceMentionFlood(message, { maxMentions: 5, timeoutMinutes: 7 }, "wl"), true);
  assert.deepEqual(calls.map(([kind]) => kind), ["delete", "timeout", "send"]);
  assert.equal(calls[1][1], 420_000);
  assert.deepEqual(calls[2][1].allowedMentions, { parse: [] });
});

test("missing native permissions fails closed without applying a timeout", async () => {
  const { message, calls } = fakeMessage({ permissions: [] });
  const events = [];
  assert.equal(await enforceMentionFlood(message, { maxMentions: 5, timeoutMinutes: 5 }, null, (code) => events.push(code)), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(events, ["spam_timeout_error"]);
});

test("guild WHITELIST and messages under the threshold are not punished", async () => {
  const whitelisted = fakeMessage({ roles: ["wl"] });
  assert.equal(await enforceMentionFlood(whitelisted.message, { maxMentions: 5, timeoutMinutes: 5 }, "wl"), false);
  assert.deepEqual(whitelisted.calls, []);
  const ordinary = fakeMessage({ mentions: 5 });
  assert.equal(await enforceMentionFlood(ordinary.message, { maxMentions: 5, timeoutMinutes: 5 }, null), false);
  assert.deepEqual(ordinary.calls, []);
});
